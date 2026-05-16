import json
import os

import httpx
import streamlit as st


# Unified backend URL
BACKEND_URL = os.getenv("BACKEND_URL", "http://backend:8000")


async def stream_graph_events(
    graph_runnable,
    messages,
    container,
):
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
            async for event in graph_runnable.astream_events(
                {"messages": messages},
                version="v2",
            ):
                event_type = event["event"]

                if event_type == "on_chat_model_stream":
                    if suppress_tokens:
                        continue

                    addition = event["data"]["chunk"].content

                    final_text += addition

                    if addition:
                        token_placeholder.write(final_text)

                elif event_type == "on_tool_start":
                    tool_name = event.get("name")

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
                    tool_name = event.get("name")

                    if tool_name in hidden_tool_names:
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
                    state = event["data"].get("output", {})

                    if isinstance(state, dict):
                        follow_up_tip_text = state.get(
                            "follow_up_tip"
                        )

        except Exception as e:
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
    # Always use BACKEND_URL unless explicitly overridden
    base_url = api_base_url or BACKEND_URL
    base_url = base_url.rstrip("/")

    stream_url = f"{base_url}/chat/stream"

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
                payload = {
                    "messages": messages,
                }

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
                        if not line:
                            continue

                        if not line.startswith("data:"):
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
                                    output_placeholder.code(
                                        event.get("output")
                                    )

                                if current_tool_status is not None:
                                    current_tool_status.update(
                                        label=f"Completed Tool {tool_name}.",
                                        expanded=False,
                                    )

                        elif event_type == "chain_end":
                            follow_up_tip_text = event.get(
                                "follow_up_tip"
                            )

                        elif event_type == "error":
                            raise RuntimeError(
                                event.get("message")
                            )

        except Exception as e:
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