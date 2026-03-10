from typing import Annotated, TypedDict, Literal
import os

from langgraph.prebuilt import ToolNode
from langgraph.graph import START, StateGraph
from langgraph.graph.message import AnyMessage, add_messages
from langchain_openai import ChatOpenAI

from agent.utils.tools import tools
from agent.utils.prompt import build_system_message, build_follow_up_tip_system_message

from dotenv import load_dotenv

load_dotenv()


# Graph state definition (extendable with additional keys if needed)
class GraphsState(TypedDict):
    """State for the main Talk2BI agent graph.

    Includes the conversation messages and an optional follow-up tip that can
    be generated at the end of a turn.
    """

    messages: Annotated[list[AnyMessage], add_messages]
    follow_up_tip: str | None


# Graph
graph = StateGraph(GraphsState)


def should_continue(state: GraphsState) -> Literal["tools", "follow-up-tip"]:
    """Route to tool execution if the model requested a tool call.

    If no tool call is requested, route to the follow-up tip node so that a
    contextual tip is generated as part of the same graph run.
    """
    last_message = state["messages"][-1]
    if last_message.tool_calls:
        return "tools"
    return "follow-up-tip"


def _call_model(state: GraphsState):
    """Invoke the LLM with tool binding and the Talk2BI system prompt.

    The system prompt is prepended on each call without being stored in the
    graph state, so it guides the model while keeping the conversation
    history clean.
    """

    llm = ChatOpenAI(
        model=os.getenv("MODEL"),
        api_key=os.getenv("OPENAI_API_KEY"),
        base_url=os.getenv("BASE_URL"),
        temperature=0.7,
        streaming=True,
    )

    llm_with_tools = llm.bind_tools(tools, parallel_tool_calls=False)

    # Prepend the system message for this model invocation.
    messages = [build_system_message(), *state["messages"]]

    response = llm_with_tools.invoke(messages)
    return {"messages": [response]}


def _follow_up_tip(state: GraphsState):
    """Create a short, LLM-generated follow-up tip.

    The tip is tailored to the user's most recent question and suggests a
    concrete next step for BI exploration.
    """

    try:
        # Configure a non-streaming LLM instance for generating the tip
        llm = ChatOpenAI(
            model=os.getenv("MODEL"),
            api_key=os.getenv("OPENAI_API_KEY"),
            base_url=os.getenv("BASE_URL"),
            temperature=0.7,
            streaming=False,
        )

        # Build a messages-style prompt: tip system message + conversation
        messages = [build_follow_up_tip_system_message(), *state["messages"]]

        response = llm.invoke(messages)
        tip = getattr(response, "content", "").strip()
    except Exception:
        # Fall back to a generic static tip if the LLM call fails.
        tip = (
            "You can ask follow-up questions to compare time periods, drill "
            "down into specific segments, or request visual summaries of your BI data."
        )

    return {"follow_up_tip": tip}


# Tools exposed to the graph
tool_node = ToolNode(tools)


# Main conversation graph structure (including follow-up tips)
graph.add_edge(START, "modelNode")
graph.add_node("tools", tool_node)
graph.add_node("modelNode", _call_model)
graph.add_node("follow-up-tip", _follow_up_tip)

graph.add_conditional_edges(
    "modelNode",
    should_continue,
)

graph.add_edge("tools", "modelNode")
graph.add_edge("follow-up-tip", "__end__")

# Compile runnable graph for the main agent
graph_runnable = graph.compile()