from typing import Annotated, TypedDict, Literal

from langgraph.prebuilt import ToolNode
from langgraph.graph import START, StateGraph
from langgraph.graph.message import AnyMessage, add_messages
from langchain_openai import ChatOpenAI

from agent.utils.tools import tools
from agent.utils.prompt import build_system_message


# Graph state definition (extendable with additional keys if needed)
class GraphsState(TypedDict):
    messages: Annotated[list[AnyMessage], add_messages]


graph = StateGraph(GraphsState)


def should_continue(state: GraphsState) -> Literal["tools", "__end__"]:
    """Route to tool execution if the model requested a tool call."""
    last_message = state["messages"][-1]
    if last_message.tool_calls:
        return "tools"
    return "__end__"


def _call_model(state: GraphsState):
    """Invoke the LLM with tool binding and the Talk2BI system prompt.

    The system prompt is prepended on each call without being stored in the
    graph state, so it guides the model while keeping the conversation
    history clean.
    """

    llm = ChatOpenAI(
        temperature=0.7,
        streaming=True,
    ).bind_tools(tools, parallel_tool_calls=False)

    # Prepend the system message for this model invocation.
    messages = [build_system_message(), *state["messages"]]

    response = llm.invoke(messages)
    return {"messages": [response]}


# Tools exposed to the graph
tool_node = ToolNode(tools)


# Graph structure
graph.add_edge(START, "modelNode")
graph.add_node("tools", tool_node)
graph.add_node("modelNode", _call_model)

graph.add_conditional_edges(
    "modelNode",
    should_continue,
)

graph.add_edge("tools", "modelNode")

# Compile runnable graph
graph_runnable = graph.compile()