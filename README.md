# 💬 Jupyter Notebook ChatCompletion for VSCode
Jupyter Notebook ChatCompletion is VSCode extension that brings the power of OpenAI's ChatCompletion API to your Jupyter Notebooks!

With this extension, you can generate completions for your code cells, effectively using Jupyter Notebooks like you would use the [OpenAI Playground](https://platform.openai.com/playground). The notebook content is sent along the notebook cells, as well as the outputs and errors/warnings for python code cells that have been executed.

![](https://github.com/iterativecloud/jupyter-notebook-chatcompletion/blob/main/demo.gif?raw=true)

When you try to send content larger than the model max token size, a dialogue with token reduction strategy appears.
![](https://github.com/iterativecloud/jupyter-notebook-chatcompletion/blob/main/demo2.gif?raw=true)

## 🌟 Features 
- Streamed completions: Generate new notebook cells, whether markdown or executable python code, and see the first results on-the-fly.
- Cancel early: Don't like what you see? You can cancel an ongoing completion at any time.
- Automatically sends Jupyter executed notebook cell outputs too. For example. For example, you can execute a Python code cell to print a file from disk which will be part of the conversation.
- Automatically sends VSCode problems of failed executions of python code cells as a part of the conversation. No need for further instructions - the model will directly help you fix the issue in the python code cell.
- OpenAI API request parameters are stored within the jupyter notebook instead of the workspace, simplying the use of different settings for different notebooks (e.g. the selection of the model).
- Customize your completions with various API parameters, including temperature, top_p, max tokens, and more.
- Manage Chat roles: set a notebook cell to the  System or Assistant role, giving you the same level of control as in the OpenAI Playground.
- Apply token reduction strategies when the model's limit have been reached
## 🚀 Getting Started 
1. Install the Jupyter Notebook ChatCompletion extension from the VSCode marketplace.
2. Open a Jupyter Notebook in VSCode.
3. Start generating completions for your code cells using the extension commands!
    - When using the extension for the first time, you will be asked for an OpenAI API key that will be saved to your VSCode settings.
    - When using the extension in a new notebook, you will be automatically asked to choose a model that will be saved to your notebook's metadata. Afterwards, you can change the model from the notebook's main menu.
## 🎮 Commands 
- **Complete with this Cell and Above** (`ctrl+shift+enter`): Generate completions using the current cell and all cells above it. You can simply karate-chop the center keys (right shift, right ctrl and main enter key) 🥋 or use the corresponding action from the cell menu.
- **Complete with this Cell** (`ctrl+shift+pagedown`): Generate completions using only the current cell. You can also use the corresponding action from the cell menu
- **Set Temperature**: Adjust the temperature parameter for controlling the randomness of the completions.
- **Set Model**: Choose the OpenAI model to use for generating completions. The set of models depends on which models have been made accessible to your OpenAI account.
- **Set Chat Role to Assistant**: Set the role of the current cell to "assistant". Useful to fabricate messages as if they have been written by the model. Responses from the model are automatically set to the assistant role.
- **Set Chat Role to System**: Set the role of the current cell to "system". Useful to define your own System Message, which should be ideally be either the first cell or the last cell in the notebook (but there is no restriction).
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

## 🔒 Full privacy
This extension doesn't (and will never) collect any information.

The release version's code can be inspected at [the main branch in GitHub](https://github.com/iterativecloud/jupyter-notebook-chatcompletion/tree/main)

The pre-release version's code can be inspected at [the edge branch in GitHub](https://github.com/iterativecloud/jupyter-notebook-chatcompletion/tree/edge)

Please note that the use of the OpenAPI API is still subject to OpenAI [API data usage policies](https://openai.com/policies/api-data-usage-policies).
## 🛠 Support
If you encounter any issues or have questions, please head over to [GitHub Issues](https://github.com/iterativecloud/jupyter-notebook-chatcompletion/issues/new) page and create a new issue. I'll be happy to help!
Feature Request are also welcome!