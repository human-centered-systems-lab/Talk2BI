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
                            f"Calling Tool {event['name']} ...", expanded=True
                        ) as s:
                            st.write("Called ", event["name"])
                            st.write("Tool input:")
                            st.code(event["data"].get("input"))
                            st.write("Tool output:")
                            output_placeholder = st.empty()
                            s.update(
                                label=f"Completed Calling Tool {event['name']}.",
                                expanded=False,
                            )

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
