// Bestaetigungsdialog als Promise — Obsidian-Modal, minimal.
import { Modal, type App } from "obsidian";

export function confirmDiscardEdits(app: App): Promise<boolean> {
  return new Promise((resolve) => {
    const modal = new (class extends Modal {
      private answered = false;
      onOpen(): void {
        this.contentEl.createEl("p", { text: "Discard unsaved edits?" });
        const row = this.contentEl.createDiv({ cls: "modal-button-container" });
        const discard = row.createEl("button", { text: "Discard", cls: "mod-warning" });
        discard.addEventListener("click", () => {
          this.answered = true;
          resolve(true);
          this.close();
        });
        const keep = row.createEl("button", { text: "Keep editing" });
        keep.addEventListener("click", () => this.close());
      }
      onClose(): void {
        if (!this.answered) resolve(false);
      }
    })(app);
    modal.open();
  });
}
