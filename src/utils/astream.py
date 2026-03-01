import streamlit as st


async def stream_graph_events(
    graph_runnable,
    messages,
    container,
) -> str:
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
        The final assistant message text that was streamed.
    """

    final_text = ""
    output_placeholder = None

    # All UI elements for the assistant message live inside the provided
    # container, so callers only need to create a single placeholder.
    with container:
        thoughts_placeholder = st.container()
        token_placeholder = st.empty()

        try:
            async for event in graph_runnable.astream_events(
                {"messages": messages}, version="v2"
            ):
                event_type = event["event"]

                if event_type == "on_chat_model_stream":
                    # Stream model output tokens
                    addition = event["data"]["chunk"].content
                    final_text += addition
                    if addition:
                        token_placeholder.write(final_text)

                elif event_type == "on_tool_start":
                    # Tool invocation started
                    with thoughts_placeholder:
                        status_placeholder = st.empty()
                        with status_placeholder.status(
                            "Calling Tool...", expanded=True
                        ) as s:
                            st.write("Called ", event["name"])
                            st.write("Tool input:")
                            st.code(event["data"].get("input"))
                            st.write("Tool output:")
                            output_placeholder = st.empty()
                            s.update(
                                label="Completed Calling Tool!",
                                expanded=False,
                            )

                elif event_type == "on_tool_end":
                    # Tool invocation finished
                    with thoughts_placeholder:
                        if output_placeholder is not None:
                            output_placeholder.code(
                                event["data"].get("output").content
                            )

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

    return final_text
