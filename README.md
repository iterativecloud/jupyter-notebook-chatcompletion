# 💬 Jupyter Notebook ChatCompletion for VSCode

Jupyter Notebook ChatCompletion is VSCode extension that brings the power of OpenAI's ChatCompletion API to your Jupyter Notebooks!

With this extension, you can generate completions for your code cells, making it easier than ever to experiment with different models and parameters. The best part? The completions are streamed, so you can cancel them at any time! 

Plus, you can optionally send cell outputs and VSCode problems detected on the cell as part of the prompt to the ChatCompletion API, giving you even more control over your completions.

Choosing the GPT-4 model with 8k or 32k tokens is recommended, as most Jupyter Notebook out there will completely fit in the prompt, including the output of executed cells. For those without OpenAI preview access, GPT-3.5-turbo will also work decently, but you will quickly reach the maximum size of a request.

## 🌟 Features 

- Streamed completions: Generate completions and see the first results on-the-fly.
- Cancel early: Don't like what you see? You can cancel an ongoing completion at any time.
- Send Jupyter notebook cell outputs and VSCode problems to the ChatCompletion API for better context-aware completions.
- Store API parameters within the notebook instead of the workspace, making side-by-side experimentations easier and more reproducible.
- Customize your completions with various API parameters, including temperature, top_p, max tokens, and more.
- Manage Chat roles: set a notebook cell to the  System or Assistant role, giving you the same level of control as in the OpenAI Playground.

## 🚀 Getting Started 

1. Install the Jupyter Notebook ChatCompletion extension from the VSCode marketplace.
2. Open a Jupyter Notebook in VSCode.
3. Start generating completions for your code cells using the extension commands!

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

## ⚙️ Configuration 

To use the extension, you'll need to provide your OpenAI API Key. You can do this by setting the `notebook-chatcompletion.openaiApiKey` configuration property in your VSCode settings. You will also be prompted for the API key on first use if it hasn't been defined yet.

## 🏄 Full freedom
In stark constrast to existing GPT-related VSCode extensions, extra care was taken to not steer the completion in any way that might conflict with the intent of your notebook. You can therefore expect the same level of flexibility as with the OpenAI Playground, but combined with the powerful features of Jupyter notebooks.

This extension will only include the following system message by default: 
"```Format your answer as markdown. If you include a markdown code block, specify the language.```"
This default system message increases the chance that the extension will detect python code as code cell instead of generic code-block (unknown language). You can set a notebook to the role "System" to define your own system message.

If you want an experience closer to ChatGPT, you can try setting the system message to: "```You are ChatGPT, a large language model trained by OpenAI. Answer as concisely as possible. Knowledge cutoff: {knowledge_cutoff} Current date: {current_date}```"

## 🛠 Support

If you encounter any issues or have questions, please head over to [GitHub Issues](https://github.com/iterativecloud/jupyter-notebook-chatcompletion/issues/new) page and create a new issue. I'll be happy to help!

## 🌈 Upcoming

I am working to improve the Jupyter Notebook ChatCompletion extension. Some of the next exciting features I am working towards are **Automatic truncation when reaching max token limit**, **Polyglot Notebook support** and supporting locally run **HuggingFace LLM models**. Stay tuned for more updates and enhancements!