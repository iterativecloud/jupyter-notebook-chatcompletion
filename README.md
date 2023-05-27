# 💬 Jupyter Notebook ChatCompletion for VSCode
Jupyter Notebook ChatCompletion is VSCode extension that brings the power of OpenAI's ChatCompletion API to your Jupyter Notebooks!

With this extension, you can generate completions for your code cells, making it easier than ever to experiment with different models and parameters. The best part? The completions are streamed, so you can cancel them at any time! 

You can optionally send cell outputs and VSCode problems detected on the cell as part of the prompt to the ChatCompletion API, giving you even more ways to add context to your notebook cell generation.

![](https://github.com/iterativecloud/jupyter-notebook-chatcompletion/blob/main/demo.gif?raw=true)

When you try to send content larger than the model max token size, a dialogue with token reduction strategy appears.
![](https://github.com/iterativecloud/jupyter-notebook-chatcompletion/blob/main/demo2.gif?raw=true)

## 🌟 Features 
- Streamed completions: Generate completions and see the first results on-the-fly.
- Cancel early: Don't like what you see? You can cancel an ongoing completion at any time.
- Send Jupyter notebook cell outputs and VSCode problems to the ChatCompletion API for better context-aware completions.
- Store API parameters within the notebook instead of the workspace, making side-by-side experimentations easier and more reproducible.
- Customize your completions with various API parameters, including temperature, top_p, max tokens, and more.
- Manage Chat roles: set a notebook cell to the  System or Assistant role, giving you the same level of control as in the OpenAI Playground.
- Apply token reduction strategies when the model's limit have been reached
## 🚀 Getting Started 
1. Install the Jupyter Notebook ChatCompletion extension from the VSCode marketplace.
2. Open a Jupyter Notebook in VSCode.
3. Start generating completions for your code cells using the extension commands!
    - When using the extension for the first time, you will be asked for an OpenAI API key that will be saved to your VSCode settings.
    - When using the extension in a new notebook, you will be asked to choose a model that will be saved to your notebook's metadata.
## 🎮 Commands 
- **Complete with this Cell and Above** (`ctrl+shift+enter`): Generate completions using the current cell and all cells above it.
- **Complete with this Cell** (`ctrl+shift+pagedown`): Generate completions using only the current cell.
- **Set Temperature**: Adjust the temperature parameter for controlling the randomness of the completions.
- **Set Model**: Choose the OpenAI model to use for generating completions.
- **Set Chat Role to Assistant**: Set the role of the current cell to "assistant".
- **Set Chat Role to System**: Set the role of the current cell to "system".
- **Set Top P Parameter**: Set the `top_p` parameter for nucleus sampling, where the model considers the results of the tokens with top_p probability mass (e.g., 0.1 means only the tokens comprising the top 10% probability mass are considered).
- **Set Max Tokens Parameter**: Set the `max_tokens` parameter to limit the maximum number of tokens generated in the chat completion.
- **Set Presence Penalty Parameter**: Set the `presence_penalty` parameter to penalize new tokens based on whether they appear in the text so far, influencing the model's likelihood to talk about new topics.
- **Set Frequency Penalty Parameter**: Set the `frequency_penalty` parameter to penalize new tokens based on their existing frequency in the text so far, decreasing the model's likelihood to repeat the same line verbatim.
- **Set Logit Bias Parameter**: Set the `logit_bias` parameter to modify the likelihood of specified tokens appearing in the completion by providing a JSON object that maps tokens to their associated bias values.
- **Set User Parameter**: Set the `user` parameter to provide a unique identifier representing your end-user, which can help OpenAI monitor and detect abuse.
## 🏄 Full freedom
You can  expect the same level of flexibility as with the [OpenAI Playground](https://platform.openai.com/playground), but combined with the powerful features of Jupyter notebooks.

This extension will only include the following system message by default: 
"```Format your answer as markdown. If you include a markdown code block, specify the language.```"
This default system message is not necessary for the extension to function but increases the chance that the extension will detect python code as code cell instead of generic code-block (unknown language). You can set a notebook to the role "System" to override this and define your own system message.

If you want an experience closer to ChatGPT, you can try setting the system message in your notebook to: "```You are ChatGPT, a large language model trained by OpenAI. Answer as concisely as possible.```"
## 🔒 Full privacy
This extension doesn't (and will never) collect any information. Beware of other [extensions](https://blog.checkpoint.com/securing-the-cloud/malicious-vscode-extensions-with-more-than-45k-downloads-steal-pii-and-enable-backdoors/) that steal PII and collect API keys!

The release version's code can be inspected at [the main branch in GitHub](https://github.com/iterativecloud/jupyter-notebook-chatcompletion/tree/main)

The pre-release version's code can be inspected at [the edge branch in GitHub](https://github.com/iterativecloud/jupyter-notebook-chatcompletion/tree/edge)

Please note that the use of the OpenAPI API is still subject to OpenAI [API data usage policies](https://openai.com/policies/api-data-usage-policies).
## 🛠 Support
If you encounter any issues or have questions, please head over to [GitHub Issues](https://github.com/iterativecloud/jupyter-notebook-chatcompletion/issues/new) page and create a new issue. I'll be happy to help!
## 🌈 Upcoming
I am working to improve the Jupyter Notebook ChatCompletion extension. Some of the next exciting features I am working towards are **Polyglot Notebook support** and supporting locally run **HuggingFace LLM models**. Stay tuned for more updates and enhancements!
## 📖 Usage Examples
- [generate-readme.ipynb](https://github.com/iterativecloud/jupyter-notebook-chatcompletion/blob/main/test/notebooks/generate-readme.ipynb) showcases how I output the code of some my project's files into the notebook and then generated the first version of this README
- [refactor-extensionJS-3.ipynb](https://github.com/iterativecloud/jupyter-notebook-chatcompletion/blob/edge/test/notebooks/refactor-extensionJS-3.ipynb) showcases how you can let the extension generate a python code cell that will implement your desired changes directly on files when run. In this case, an Example 1 and 2 has been set up and in Example 3 we then additionally instruct ```Apply your changes like you did in Example 1 and 2```. It is possible to make this work without instructing it specifically to look at the examples, but this requires a few-shot prompt with even more examples, which eats up too many tokens when we only have 8k tokens. The 32k tokens version of gpt-4 works best for this - but burns quite a lot of money!