# Podoo Copilot prototype

This fork adds an Odoo-focused Chrome side panel to Page Agent. It uses the current Odoo screen and locally saved process rules to explain a workflow, guide a user through it, or carry out a requested task.

## Try it locally

1. Use Node 22.22.1 or newer and npm 11.6.3 or newer.
2. Run `npm ci`, then `npm run build:ext` from the repository root.
3. In Chrome, open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and select `packages/extension/.output/chrome-mv3`.
4. Open an Odoo web client tab and click the extension icon.
5. In **Configuración**, enter a model endpoint and API key approved for the Odoo data you will use. The upstream free testing endpoint is blocked for Podoo tasks.
6. Optionally expand **Reglas de tu empresa** and add approved process rules. Rules are stored in Chrome local extension storage for that Odoo origin.
7. Choose **Entender**, **Guiarme**, or **Hacer conmigo**, then ask about the open screen. You can ask follow-up questions in the same chat.
8. To try live voice in the side panel, use an OpenAI API key with the base URL `https://api.openai.com/v1`, click the microphone icon, then **Iniciar voz**. The first time, Podoo opens a full extension tab: click **Permitir micrófono** there and allow access in Chrome. The tab closes and voice starts in the side panel. Click **Terminar voz** to close the Realtime session.

The side panel reads the Odoo app, view, breadcrumbs, record title, and current URL path from the rendered page. Page Agent supplies the interactive DOM snapshot. It refreshes screen context as a task progresses. It stops when the tab stops being Odoo or moves to another Odoo origin.

## Modes

| Mode (UI)     | Behavior                                                                                                                                                                                                                                                       |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Entender      | Explains the current screen and its purpose. Page-changing tools are unavailable.                                                                                                                                                                              |
| Guiarme       | Gives one concrete next step for the user to perform. Page-changing tools are unavailable.                                                                                                                                                                     |
| Hacer conmigo | The task request authorizes routine navigation, field edits, and saving drafts. Consequential clicks, such as confirming, sending, deleting, or paying, ask for confirmation in the side panel. The screen and indexed target are checked again before acting. |

The chat is saved locally per Odoo origin, so reopening the side panel restores the conversation for that instance. Podoo sends a bounded window of recent turns to the model for follow-up questions. Previous replies are context, not proof that an action occurred; the current Odoo screen is checked again for every task. **Nueva conversación** clears the chat for the current origin. The task trace remains separately available in **Registro de tareas**.

The Realtime 2.1 voice pilot runs inside the Chrome side panel. It reuses the OpenAI key already configured for text tasks to mint a short-lived Realtime credential in the extension background worker. The model can answer general Odoo questions or call tools to inspect the live screen, choose one indexed control, and highlight it. After the user uses a highlighted control, the model inspects the screen again and decides the next step; there is no predefined workflow selector. The extension rejects stale snapshots, controls absent from the inspected screen, and targets that are no longer visible. The overlay does not click or write in Odoo, and a save click is not treated as proof that a record was saved. Its audio conversation lasts for the live session; the current text chat history remains separate. The model's general Odoo knowledge is not a cited, versioned knowledge base; that remains a needed Odoo Brain integration.

Tab switching, opening, and closing tools are unavailable in all three modes. The upstream page-to-extension execution bridge is disabled in this fork so page scripts cannot bypass the side panel controls.

## Architecture and current limits

```text
Odoo rendered page → Odoo context + Page Agent DOM snapshot
                         ↓
       Company rules + recent chat for this origin
                         ↓
                 Page Agent reasoning
                         ↓
   Entender / Guiarme / task-scoped Hacer conmigo
```

This is an extension prototype with no Hermes or Jev dependency. It does not yet connect to an Odoo server addon or a versioned knowledge base. Company rules are manually entered text; there is no retrieval, source citation, role-aware policy, or typed Odoo RPC. DOM automation can miss custom widgets and cannot prove a business transaction succeeded. For a production adoption copilot, the next integration should be a standalone Odoo addon owned by this project. It can provide model, record, user role, approved workflow, and cited knowledge for the current screen. High-impact changes should use explicit Odoo operations with a confirmation step and an auditable result.

The design was informed by the user's previous `odoo-page-agent-jev-pack.zip` reference. The archive was treated as design input; no code or instructions from it were copied into this fork.
