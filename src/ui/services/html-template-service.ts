import * as vscode from "vscode";
import * as fs from "fs";

/**
 * Service for managing HTML templates with separated CSS and JavaScript
 */
export class HtmlTemplateService {
  private extensionUri: vscode.Uri;

  constructor(extensionUri: vscode.Uri) {
    this.extensionUri = extensionUri;
  }

  /**
   * Get the complete HTML for the chat webview
   */
  public getHtmlForWebview(webview: vscode.Webview): string {
    // Get paths to CSS, JS, and HTML files from organized structure
    const cssPath = vscode.Uri.joinPath(
      this.extensionUri,
      "src",
      "ui",
      "styles",
      "compiled.css"
    );
    const jsPath = vscode.Uri.joinPath(
      this.extensionUri,
      "src",
      "ui",
      "scripts",
      "chat-view.js"
    );
    const htmlPath = vscode.Uri.joinPath(
      this.extensionUri,
      "src",
      "ui",
      "views",
      "chat-view.html"
    );

    // Convert to webview URIs
    const cssUri = webview.asWebviewUri(cssPath);
    const jsUri = webview.asWebviewUri(jsPath);

    try {
      // Read the HTML template
      const htmlTemplate = fs.readFileSync(htmlPath.fsPath, "utf8");

      // Replace placeholders with actual paths
      const html = htmlTemplate
        .replace("{CSS_PATH}", cssUri.toString())
        .replace("{JS_PATH}", jsUri.toString());

      return html;
    } catch (error) {
      console.error("Error loading HTML template:", error);
      vscode.window.showErrorMessage(
        "Failed to load chat view template. Please check the extension installation."
      );
      return "<html><body><h1>Error loading chat view</h1></body></html>";
    }
  }
}
