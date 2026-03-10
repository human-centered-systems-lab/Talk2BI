# Talk2BI

[![KIT h-lab](https://img.shields.io/badge/KIT-h--lab-green?style=flat-square)](https://h-lab.win.kit.edu)
[![Streamlit](https://img.shields.io/badge/Streamlit-App-FF4B4B?logo=streamlit&logoColor=white)](https://streamlit.io)
![LangGraph](https://img.shields.io/badge/LangGraph-Agent%20Orchestration-blue?logo=langchain&logoColor=white)
![Databricks](https://img.shields.io/badge/Databricks-Data%20Platform-orange?logo=databricks&logoColor=white)
[![OpenAI](https://img.shields.io/badge/OpenAI-API-black?style=flat-square&logo=openai&logoColor=white)](https://openai.com/)
[![Python](https://img.shields.io/badge/Python-3.14-blue.svg?style=flat-square)](https://www.python.org/)
[![uv](https://img.shields.io/badge/uv-package%20manager-FFD43B?style=flat-square&logo=python&logoColor=black)](https://github.com/astral-sh/uv)

Open source is a commitment to transparency, accountability, and collective improvement. Talk2BI follows this principle by making business intelligence accessible through natural language; without sacrificing rigor or reproducibility. Our goal is to remove barriers so that understanding, verifying, and extending AI-based systems is possible for everyone. Anyone should be able to use software, inspect its logic, understand how it works, and build upon it. Built with LangGraph and Streamlit, Talk2BI is an open-access initiative by the [Human-Centered Systems Lab (h-Lab)](https://h-lab.win.kit.edu) at Karlsruhe Institute of Technology (KIT), Germany.

![App](./demo/app_screenshot.gif)

## Get started

1. Install uv  
   https://docs.astral.sh/uv/getting-started/installation/

2. Install dependencies
   ```bash
   uv sync
   ```

3. Create your .env file
   ```bash
   cp .env.example .env
   ```

4. Configure environment variables for your AI model and database connection (Databricks)
   ```bash
   # Edit .env and set your keys
   OPENAI_API_KEY=...
   ...
   DATABRICKS_HOST=...
   ...
   ```

5. Run the application
   ```bash
   cd src
   uv run streamlit run streamlit_app.py
   ```

## Main code structure

```bash
src/
├── streamlit_app.py    # Streamlit UI app
├── agent/
│   ├── agent.py        # Main agent
│   └── utils/
│       ├── prompt.py   # prompt templates
│       └── tools.py    # Agent tools
└── utils/              
    └── astream.py      # Model stream utility  
```

<<<<<<< Updated upstream
If you want to change the agent behavior, go to `src/agent/agent.py`.  
If you want to change the application (UI and overall flow), go to `src/streamlit_app.py`.

## Contributing

Contributions are very welcome.

- For code changes, fork the repository and open a pull request with a clear description of the motivation and the changes.
- When possible, keep changes small and focused, and align with the existing project structure (`src/agent` for agent behavior, `src/streamlit_app.py` for UI).

We especially welcome contributions that:

- Add or improve various agent tools (data sources, BI operations, semantic search, etc.).
- Enhance the UI and user experience (chat interactions, visualizations, filters, history, etc.).
- Improve BI-related capabilities more broadly (analysis flows, explanations, guidance).
- Enhance the prompt, agent logic, or evaluation.
- Polish the developer experience (docs, examples, or tests).

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE)
file for full license text.

![Human-Centered Systems Lab (h-Lab)](https://h-lab.win.kit.edu/img/LOGO_lang_klein_RZ.svg)
=======
- To change the **agent behavior** (how queries are interpreted, how tools are used, etc.), edit `src/agent/agent.py` and the helper files in `src/agent/utils/`.
- To change the **application UI and overall flow**, edit `src/streamlit_app.py`.
- To adjust **streaming behaviour**, see `src/utils/astream.py`.

## Contributing

We welcome contributions from everyone! Whether it’s bug fixes, new features, documentation improvements, or ideas, your help makes Talk2BI better.

To contribute:
1.	Fork the repo and create a branch.
2.	Make changes and follow PEP8/code style.
3.	Commit with a clear message and push your branch.
4.	Open a Pull Request describing your changes.

Feel free to also report bugs via GitHub issues.

## Acknowledgements

Talk2BI is made possible thanks to the incredible work of the open-source community. Thank you to all the developers, maintainers, and contributors whose tools, libraries, and ideas we rely on every day. For questions or feedback, you can reach out to Niklas Wagner at [niklas.wagner@kit.edu](mailto:niklas.wagner@kit.edu).

## License

This project is licensed under the [MIT License](./LICENSE) – see the LICENSE file for details.
>>>>>>> Stashed changes
