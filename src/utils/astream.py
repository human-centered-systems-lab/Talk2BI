import json
import os

import httpx
import streamlit as st


async def stream_graph_events(
    graph_runnable,
    messages,
    container,
):
    """Stream events from a LangGraph runnable and render them in Streamlit.

    This utility encapsulates the astream_events loop used by the Streamlit app
    so that UI rendering logic for streaming tokens and tool calls is kept in
    one place.

    Args:
        graph_runnable: A compiled LangGraph runnable exposing ``astream_events``.
        messages: The current list of chat messages (used as graph state).
        container: A Streamlit container inside the assistant chat message in
            which all streaming output (tokens, tool thoughts, etc.) will be
            rendered.

    Returns:
        A tuple of
        - The final assistant message text that was streamed.
        - An optional follow-up tip string taken from the graph state.
    """

    final_text = ""
    follow_up_tip_text: str | None = None
    hidden_tool_names = {"sql_db_query_checker"}
    # When True, we suppress streaming tokens from interim LLM calls
    # (e.g., internal query-checker tools) so they are not appended
    # to the final assistant answer.
    suppress_tokens = False
    output_placeholder = None
    current_tool_status = None

    # All UI elements for the assistant message live inside the provided
    # container, so callers only need to create a single placeholder.
    with container:
        thoughts_placeholder = st.container()
        token_placeholder = st.empty()
        follow_up_placeholder = st.empty()

        try:
            async for event in graph_runnable.astream_events(
                {"messages": messages}, version="v2"
            ):
                event_type = event["event"]

                if event_type == "on_chat_model_stream":
                    # Stream model output tokens, unless they come from a
                    # hidden tool such as the SQL query checker.
                    if suppress_tokens:
                        continue

                    addition = event["data"]["chunk"].content
                    final_text += addition
                    if addition:
                        token_placeholder.write(final_text)

                elif event_type == "on_tool_start":
                    # Tool invocation started
                    tool_name = event.get("name")

                    # For internal query-checker tools, we still want to
                    # display the "Called ..." block, but we do not want
                    # their LLM tokens to be appended to the final answer.
                    if tool_name in hidden_tool_names:
                        suppress_tokens = True

                    with thoughts_placeholder:
                        status_placeholder = st.empty()
                        with status_placeholder.status(
                            f"Calling Tool {event['name']} ...",
                            expanded=False,
                        ) as s:
                            st.write("Called ", event["name"])
                            st.write("Tool input:")
                            st.code(event["data"].get("input"))
                            st.write("Tool output:")
                            output_placeholder = st.empty()
                            current_tool_status = s

                elif event_type == "on_tool_end":
                    # Tool invocation finished
                    tool_name = event.get("name")

                    if tool_name in hidden_tool_names:
                        # Re-enable token streaming for normal model output
                        suppress_tokens = False

                    with thoughts_placeholder:
                        if output_placeholder is not None:
                            output_placeholder.code(
                                event["data"].get("output").content
                            )
                        if current_tool_status is not None:
                            current_tool_status.update(
                                label=f"Completed Tool {tool_name}.",
                                expanded=False,
                            )

                elif event_type == "on_chain_end":
                    # When the graph finishes, capture the follow-up tip
                    # from the final state if present.
                    state = event["data"].get("output", {})
                    if isinstance(state, dict):
                        follow_up_tip_text = state.get("follow_up_tip")

        except Exception as e:
            # Show an error "thought" block
            with thoughts_placeholder:
                status_placeholder = st.empty()
                with status_placeholder.status(
                    "Encountered an error while thinking",
                    state="error",
                    expanded=True,
                ):
                    st.write(
                        "An internal error occurred while generating the response."
                    )

            final_text += (
                "Thank you for your message. "
                f"However, an error occurred while processing the response: {e}"
            )
            token_placeholder.write(final_text)

    return final_text, follow_up_tip_text


async def stream_graph_events_via_api(
    messages,
    container,
    api_base_url: str | None = None,
    session_id: str | None = None,
    user_id: str | None = None,
):
    """Stream events from the FastAPI backend and render them in Streamlit.

    This function mirrors the behaviour of ``stream_graph_events`` but uses
    the HTTP streaming API exposed by ``src/api/route.py``.

    Internally, the backend itself uses ``graph_runnable.astream_events`` and
    maps LangGraph events onto a simplified JSON protocol:

    - {"type": "token", "content": str}
    - {"type": "tool_start", "name": str, "input": Any}
    - {"type": "tool_end", "name": str, "output": str}
    - {"type": "chain_end", "follow_up_tip": str | null}
    - {"type": "error", "message": str}
    """

    base_url = api_base_url or os.getenv("TALK2BI_API_URL", "http://localhost:8000")
    base_url = base_url.rstrip("/")
    stream_url = base_url + "/chat/stream"

    final_text = ""
    follow_up_tip_text: str | None = None
    hidden_tool_names = {"sql_db_query_checker"}
    suppress_tokens = False
    output_placeholder = None
    current_tool_status = None

    with container:
        thoughts_placeholder = st.container()
        token_placeholder = st.empty()
        follow_up_placeholder = st.empty()

        try:
            async with httpx.AsyncClient(timeout=None) as client:
                payload = {"messages": messages}
                # Optionally forward the session and user identifiers so the
                # backend can distinguish chat sessions and end users.
                if session_id is not None:
                    payload["session_id"] = session_id
                if user_id is not None:
                    payload["user_id"] = user_id

                async with client.stream(
                    "POST",
                    stream_url,
                    json=payload,
                ) as response:
                    response.raise_for_status()

                    async for line in response.aiter_lines():
                        if not line or not line.startswith("data:"):
                            continue

                        data_str = line[len("data:") :].strip()
                        if not data_str:
                            continue

                        try:
                            event = json.loads(data_str)
                        except json.JSONDecodeError:
                            continue

                        event_type = event.get("type")

                        if event_type == "token":
                            if suppress_tokens:
                                continue

                            addition = event.get("content", "")
                            final_text += addition
                            if addition:
                                token_placeholder.write(final_text)

                        elif event_type == "tool_start":
                            tool_name = event.get("name")

                            if tool_name in hidden_tool_names:
                                suppress_tokens = True

                            with thoughts_placeholder:
                                status_placeholder = st.empty()
                                with status_placeholder.status(
                                    f"Calling Tool {tool_name} ...",
                                    expanded=False,
                                ) as s:
                                    st.write("Called ", tool_name)
                                    st.write("Tool input:")
                                    st.code(event.get("input"))
                                    st.write("Tool output:")
                                    output_placeholder = st.empty()
                                    current_tool_status = s

                        elif event_type == "tool_end":
                            tool_name = event.get("name")

                            if tool_name in hidden_tool_names:
                                suppress_tokens = False

                            with thoughts_placeholder:
                                if output_placeholder is not None:
                                    output_placeholder.code(event.get("output"))
                                if current_tool_status is not None:
                                    current_tool_status.update(
                                        label=f"Completed Tool {tool_name}.",
                                        expanded=False,
                                    )

                        elif event_type == "chain_end":
                            follow_up_tip_text = event.get("follow_up_tip")

                        elif event_type == "error":
                            raise RuntimeError(event.get("message"))

        except Exception as e:  # pragma: no cover - defensive fallback
            with thoughts_placeholder:
                status_placeholder = st.empty()
                with status_placeholder.status(
                    "Encountered an error while thinking",
                    state="error",
                    expanded=True,
                ):
                    st.write(
                        "An internal error occurred while generating the response."
                    )

            final_text += (
                "Thank you for your message. "
                f"However, an error occurred while processing the response: {e}"
            )
            token_placeholder.write(final_text)

    return final_text, follow_up_tip_text
