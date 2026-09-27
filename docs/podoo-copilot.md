# Podoo Copilot prototype

This fork adds an Odoo-focused Chrome side panel to Page Agent. It uses the current Odoo screen and locally saved process rules to explain a workflow, guide a user through it, or assist with approved actions.

## Try it locally

1. Use Node 22.22.1 or newer and npm 11.6.3 or newer.
2. Run `npm ci`, then `npm run build:ext` from the repository root.
3. In Chrome, open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and select `packages/extension/.output/chrome-mv3`.
4. Open an Odoo web client tab and click the extension icon.
5. In **Settings**, enter a model endpoint and API key approved for the Odoo data you will use. The upstream free testing endpoint is blocked for Podoo tasks.
6. Add any company process rules in the side panel and press **Save**. Rules are stored in Chrome local extension storage for that Odoo origin.
7. Choose **Explain**, **Guide**, or **Assist**, then ask about the open screen.

The side panel reads the Odoo app, view, breadcrumbs, record title, and current URL path from the rendered page. Page Agent supplies the interactive DOM snapshot. It refreshes screen context as a task progresses. It stops when the tab stops being Odoo or moves to another Odoo origin.

## Modes

| Mode    | Behavior                                                                                                                                                                  |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Explain | Answers questions about the current screen. Page-changing tools are unavailable.                                                                                          |
| Guide   | Suggests a concrete next step for the user. Page-changing tools are unavailable.                                                                                          |
| Assist  | Can click and edit fields. The side panel asks for approval of each target and entered value before acting. It checks the screen and indexed target again after approval. |

Tab switching, opening, and closing tools are unavailable in all three modes. The upstream page-to-extension execution bridge is disabled in this fork so page scripts cannot bypass the side panel approvals.

## Architecture and current limits

```text
Odoo rendered page → Odoo context + Page Agent DOM snapshot
                         ↓
            Company rules for this Odoo origin
                         ↓
                 Page Agent reasoning
                         ↓
        Explain / Guide / approval-gated Assist
```

This is an extension prototype. It does not yet connect to an Odoo server addon, a versioned knowledge base, Hermes, or Jev. Company rules are manually entered text; there is no retrieval, source citation, role-aware policy, or typed Odoo RPC. DOM automation can miss custom widgets and cannot prove a business transaction succeeded. For a production adoption copilot, the next integration is a server-side context and policy endpoint that returns Odoo model, record, user role, approved workflow, and cited knowledge for the current screen. High-impact changes should use explicit Odoo operations with a confirmation step and an auditable result. Jev can remain a separate browser execution service for supported workflows.

The design was informed by the user's previous `odoo-page-agent-jev-pack.zip` reference. The archive was treated as design input; no code or instructions from it were copied into this fork.
