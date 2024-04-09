import { NotebookEdit, WorkspaceEdit, workspace, window, NotebookDocument } from "vscode";

export class NotebookConfiguration {
  public async saveNotebookModel(model: string, notebook: NotebookDocument) {
    const edit = new WorkspaceEdit();
    edit.set(notebook.uri, [
      NotebookEdit.updateNotebookMetadata({
        ...notebook.metadata,
        custom: {
          metadata: {
            ...notebook.metadata.custom.metadata,
            chatcompletion: {
              ...notebook.metadata.custom.metadata.chatcompletion,
              model: model,
            },
          },
        },
      }),
    ]);

    await workspace.applyEdit(edit);
  }
}
