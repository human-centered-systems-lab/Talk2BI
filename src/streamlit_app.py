import asyncio
import os
import uuid

import httpx
import streamlit as st
from dotenv import load_dotenv

from utils.astream import stream_graph_events_via_api

APP_TITLE = "Talk2BI"
APP_ICON = "💡"
WELCOME_MESSAGE = "Hello! How can I assist you today?"


def _get_or_create_session_id() -> str:
    """Get the current session_id from the URL or create a new one.

    The session_id is persisted in two places:
    - st.session_state["session_id"] so the Python side can use it.
    - The browser URL query parameter `?session_id=...` so that
      reloading or sharing the URL keeps the same session.
    """

    # If we already resolved a session_id for this Streamlit session, first
    # check whether the URL query parameter has changed (e.g. user opened a
    # shared link with a different session_id). If so, switch to that
    # session and clear cached messages so they can be reloaded from the
    # backend.
    if "session_id" in st.session_state:
        current = st.session_state.session_id
        query_params = st.query_params
        param_value = query_params.get("session_id")

        if isinstance(param_value, list):
            url_session_id = param_value[0]
        else:
            url_session_id = param_value

        if url_session_id and url_session_id != current:
            # Switch to the session indicated by the URL.
            st.session_state["session_id"] = url_session_id
            st.query_params["session_id"] = url_session_id

            # Force reinitialisation so history for the new session_id
            # can be fetched from the backend.
            for key in ["messages", "follow_up_tips"]:
                if key in st.session_state:
                    del st.session_state[key]

            return url_session_id

        return current

    # If the URL already contains a session_id query parameter (e.g., when
    # opening a shared link or reloading), honour it so that we can load the
    # corresponding history from the backend.
    query_params = st.query_params
    param_value = query_params.get("session_id")

    if isinstance(param_value, list):
        session_id = param_value[0]
    else:
        session_id = param_value

    if not session_id:
        session_id = str(uuid.uuid4())

    st.session_state["session_id"] = session_id
    st.query_params["session_id"] = session_id
    return session_id


def _get_or_create_user_id() -> str:
    """Get the current user_id from the URL or create a new one.

    The user_id is intended to identify the (logical) end user opening the
    app, independently of the chat session identifier. It is persisted in
    two places:

    - ``st.session_state["user_id"]`` so the Python side can use it.
    - The browser URL query parameter ``?user_id=...`` so that reloading or
      sharing the URL keeps the same user identifier.
    """

    # Reuse an existing user_id for the current Streamlit session if one
    # was already established.
    if "user_id" in st.session_state:
        return st.session_state.user_id

    # Otherwise, honour any user_id that may already be present in the URL
    # (e.g., when the app is opened via a link like
    # ``http://localhost:8501/?user_id=12345``).
    query_params = st.query_params
    param_value = query_params.get("user_id")

    if isinstance(param_value, list):
        user_id = param_value[0]
    else:
        user_id = param_value

    # If no user_id was provided externally, generate a fresh UUID so that
    # each new visitor gets a stable identifier for their browsing session.
    if not user_id:
        user_id = str(uuid.uuid4())

    st.session_state["user_id"] = user_id
    st.query_params["user_id"] = user_id
    return user_id


async def main():
    load_dotenv()

    st.set_page_config(
        page_title=APP_TITLE,
        page_icon=APP_ICON,
        menu_items={},
    )

    # Ensure we have stable per-URL identifiers for the user and chat
    # session. The user_id may be provided externally via the URL
    # (e.g., ``?user_id=12345``); otherwise it is generated as a UUID.
    user_id = _get_or_create_user_id()
    # Ensure we have a stable per-URL chat session identifier.
    session_id = _get_or_create_session_id()

    @st.dialog("Share Chat", width="small")
    def share_chat_dialog() -> None:
        """Dialog showing a shareable URL for the current chat session."""

        app_base_url = os.getenv("TALK2BI_APP_URL", "http://localhost:8501").rstrip("/")
        current_session_id = st.session_state.get("session_id")

        if current_session_id:
            # Share URLs only expose the chat session identifier so that
            # recipients can open the specific conversation. The user_id is
            # intentionally not included.
            share_url = f"{app_base_url}/?session_id={current_session_id}"
            st.caption("Copy and share this URL to open the current chat session:")
            st.code(share_url, language="text")
        else:
            st.info("No active chat session yet. Send a message to create one.")

        if st.button("Close"):
            # Closing the dialog is handled by Streamlit; no additional
            # state bookkeeping is required here.
            pass

    @st.dialog("Recent Chats", width="large")
    def recent_chats_dialog() -> None:
        """Dialog listing recent chat sessions for the current user.

        Shows up to the 10 most recent sessions (for the current user_id)
        with a short preview of the first message. Clicking "Open" on any
        entry jumps into that chat session.
        """

        if not user_id:
            # This should not normally happen because a user_id is always
            # created, but keep a graceful fallback.
            st.markdown("### Your recent chats")
            return

        try:
            api_base_url = os.getenv("TALK2BI_API_URL", "http://localhost:8000")
            base_url = api_base_url.rstrip("/")
            recent_url = f"{base_url}/chat/recent-sessions/{user_id}?limit=10"

            resp = httpx.get(recent_url, timeout=5.0)
            resp.raise_for_status()
            data = resp.json()
            sessions = data.get("sessions", [])
        except Exception:
            st.markdown("### Your recent chats")
            st.error("Could not load recent chats. Please try again later.")
            return

        # Always render the section header; if there are no sessions yet,
        # the list simply remains empty.
        st.markdown("### Your recent chats")

        for s in sessions:
            raw_preview = s.get("first_message") or "(no message yet)"
            preview = raw_preview[:100] + ("…" if len(raw_preview) > 100 else "")
            last_activity = s.get("last_activity", "")

            col_main, col_btn = st.columns([4, 1])
            with col_main:
                st.markdown(f"**{preview}**")
                if last_activity:
                    st.caption(f"Last activity: {last_activity}")
            with col_btn:
                if st.button("Open", key=f"recent_open_{s['session_id']}"):
                    target_session_id = s["session_id"]
                    # Update URL query parameter and rerun to load that session.
                    st.query_params["session_id"] = target_session_id
                    st.session_state["session_id"] = target_session_id
                    # Clear current messages so history is re-fetched in main.
                    for key in ["messages", "follow_up_tips"]:
                        if key in st.session_state:
                            del st.session_state[key]
                    st.rerun()

    with st.sidebar:
        st.header(f"{APP_ICON} {APP_TITLE}")

        ""
        "Enabling Natural Language Access to Business Intelligence. An open-access initiative by the [human-centered systems Lab (h-lab)](https://h-lab.win.kit.edu/), Karlsruhe Institute of Technology (KIT), Germany."
        ""

        if st.button(":material/chat: New Chat", use_container_width=True):
            # Start a brand-new logical chat session and update URL param.
            new_session_id = str(uuid.uuid4())
            st.session_state["session_id"] = new_session_id
            st.query_params["session_id"] = new_session_id

            st.session_state.messages = []
            st.session_state.messages.append(
                {"role": "assistant", "content": WELCOME_MESSAGE}
            )
            st.rerun()

        # Button to open a prettier recent-chats dialog for the current user.
        if st.button(":material/history: Recent Chats", use_container_width=True):
            recent_chats_dialog()

        # Share current chat via URL (including the session_id query param).
        # Use a Material icon button that, when clicked, opens a Streamlit
        # dialog with the URL so it can be copied and shared.
        if st.button(":material/share: Share Chat", use_container_width=True):
            share_chat_dialog()

        "[View the source code](https://github.com/human-centered-systems-lab/Talk2BI)"

        st.caption("Built using LangGraph and Streamlit.")

    # Initialize session state
    if "messages" not in st.session_state:
        history_loaded = False

        # Try to load existing history for this session from the backend.
        # Mirror the default used in ``stream_graph_events_via_api`` so that
        # history loading works out of the box when the backend runs on
        # http://localhost:8000.
        api_base_url = os.getenv("TALK2BI_API_URL", "http://localhost:8000")
        base_url = api_base_url.rstrip("/")
        history_url = f"{base_url}/chat/history/{session_id}"

        try:
            # Use a short-lived async client to fetch stored messages.
            async with httpx.AsyncClient(timeout=None) as client:
                resp = await client.get(history_url)
                resp.raise_for_status()
                data = resp.json()
                history_messages = data.get("messages", [])

            messages: list[dict[str, str]] = []
            for msg in history_messages:
                role = msg.get("role")
                content = msg.get("content")
                if not role or not content:
                    continue
                messages.append({"role": role, "content": content})

            if messages:
                st.session_state.messages = messages
                history_loaded = True

        except Exception:
            # History loading is best-effort; fall back to a fresh
            # welcome message if anything goes wrong.
            history_loaded = False

        if not history_loaded:
            st.session_state.messages = []
            st.session_state.messages.append(
                {"role": "assistant", "content": WELCOME_MESSAGE}
            )

    # Render chat history
    for idx, message in enumerate(st.session_state.messages):
        with st.chat_message(message["role"]):
            st.markdown(message["content"])

            # If there is a follow-up tip associated with this assistant
            # message, render it in a subtle info box just below.
            tips = st.session_state.get("follow_up_tips", {})
            tip_text = tips.get(idx)
            if message["role"] == "assistant" and tip_text:
                st.info(tip_text)

    # Handle user input
    user_input = st.chat_input("Ask me anything...")
    if user_input:
        st.chat_message("user").markdown(user_input)
        st.session_state.messages.append(
            {"role": "user", "content": user_input}
        )

        # Render assistant response using shared streaming utility
        with st.chat_message("assistant"):
            container = st.container()

            # Use the FastAPI backend, which itself uses LangGraph
            # ``astream_events`` under the hood.
            final_text, follow_up_tip_text = await stream_graph_events_via_api(
                messages=st.session_state.messages,
                container=container,
                api_base_url=os.getenv("TALK2BI_API_URL"),
                session_id=st.session_state.get("session_id"),
                user_id=st.session_state.get("user_id"),
            )

            # Persist assistant response
            st.session_state.messages.append(
                {"role": "assistant", "content": final_text}
            )

            # Store tip keyed by message index so it can be displayed with the
            # corresponding assistant message when rendering history.
            if follow_up_tip_text:
                st.info(follow_up_tip_text)
                tips = st.session_state.get("follow_up_tips", {})
                assistant_index = len(st.session_state.messages) - 1
                tips[assistant_index] = follow_up_tip_text
                st.session_state["follow_up_tips"] = tips

if __name__ == "__main__":
    asyncio.run(main())