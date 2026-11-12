# Template tools

Status: draft · Owner: Francesca Guiducci · Last updated: 2026-11-12

## Goal

Offer the Todoist template features from the web app through the MCP, built on the public template API ([RESTful Template API spec](https://github.com/Doist/specs/blob/main/Backend/restful-template-api.md); Doist/Todoist#30739, Doist/Todoist#30740, Doist/Todoist#30742, Doist/Todoist#30743, Doist/Todoist#30744, Doist/Todoist#31042).

Today the server has two template tools, added in #555:

- `export-project-template` returns a project as CSV content or as a shareable download URL.
- `import-project-template` adds a template to an existing project, taken either from a template ID/URL or from CSV content. To start a new project from a template, the model has to call `add-projects` first and then import into it.

## Tools

| Tool                           | What it does                                                                                                                                                                                                                                                                                                        | Replaces                                                                                 | API route                                                                                                       | SDK method                                                                                                                                                                              | Status                                                                     |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `export-project-as-csv`        | Returns a project as CSV content, or as a shareable download link until Doist/Issues#21076 is decided (see below).                                                                                                                                                                                                  | `export-project-template`                                                                | `GET /templates/file`                                                                                           | `exportProjectAsCSV` (Doist/todoist-sdk-typescript#750; `exportTemplateAsFile` until then)                                                                                              | Drafted in #707; dropping the link in #713, pending Doist/Issues#21076     |
| `create-template`              | Creates a reusable template, like todoist-web's create flow, from a project ("Save as template"), from CSV content, or from scratch (a blank draft). Returns the draft first by default; `preview: false` saves it, with `content` if it was edited. Workspace and sharing are applied after saving, as in the app. | `save-project-as-template` (earlier draft) and `create-template-from-csv` (#679, closed) | `GET /templates/preview`, `POST /templates/user`, `POST /templates/user/preview`, `POST /templates/user/import` | `previewProjectAsTemplate`, `saveProjectAsTemplate` (Doist/todoist-sdk-typescript#746), `previewTemplateFromCSV`, `createTemplate`, `updateTemplate` (Doist/todoist-sdk-typescript#748) | Drafted in #695                                                            |
| `import-into-project`          | Adds a gallery or saved template (by ID or URL) or CSV content to an existing project.                                                                                                                                                                                                                              | `import-project-template`                                                                | `POST /projects/{project_id}/import_template`, `POST /projects/{project_id}/import`                             | `importTemplateFromId` (Doist/todoist-sdk-typescript#749), `importCSVIntoProject` (Doist/todoist-sdk-typescript#750)                                                                    | Drafted in #708                                                            |
| `create-project-from-template` | Creates a new project from a gallery or saved template, by template ID or URL. Templates only, not CSV content.                                                                                                                                                                                                     | The `add-projects` then import workaround from #555                                      | `POST /projects/from_template`                                                                                  | `createProjectFromTemplateId` (Doist/todoist-sdk-typescript#746)                                                                                                                        | Drafted in #665                                                            |
| `update-template`              | Renames a saved template, changes its description or color, edits its content (layout, sections, tasks, comments) or replaces it from a project, moves it into a workspace, or shares it with workspace members.                                                                                                    | —                                                                                        | `PUT /templates/user/{template_id}`                                                                             | `updateTemplate` (Doist/todoist-sdk-typescript#748), with `content` in Doist/todoist-sdk-typescript#751                                                                                 | Drafted in #666; content editing in #680                                   |
| `get-template`                 | Returns a template's details and full content (layout, sections, tasks, comments), in the shape `update-template` takes back. Read-only.                                                                                                                                                                            | New                                                                                      | `GET /templates/{template_id}`, `GET /templates/{template_id}/preview`                                          | `getTemplate` (Doist/todoist-sdk-typescript#747), `getTemplateContent` (Doist/todoist-sdk-typescript#751)                                                                               | Drafted in #680                                                            |
| `find-templates`               | Searches gallery, personal and workspace templates, so the model can find a template without the user supplying its ID.                                                                                                                                                                                             | —                                                                                        | `GET /templates`, `GET /templates/{template_id}`                                                                | `getTemplates`, `getTemplate` (Doist/todoist-sdk-typescript#747)                                                                                                                        | Drafted in #706                                                            |
| `delete-template`              | Deletes a saved template.                                                                                                                                                                                                                                                                                           | —                                                                                        | `DELETE /templates/user/{template_id}`                                                                          | None                                                                                                                                                                                    | Blocked: the route is still private. Backend has been asked to publish it. |

`export-project-template` and `import-project-template` are removed once their replacements ship.

### One tool per result

Each tool produces one kind of result, and takes its starting point as an input:

- `create-template` makes a template, from a project, a CSV or a blank draft.
- `import-into-project` adds content to a project, from a template or a CSV.
- `create-project-from-template` makes a project, from a template.

This follows todoist-web, which has one create flow for templates whatever they start from, and matches the CLI's `td project import --from-csv` / `--from-template`. It keeps one copy of the typed `content` input instead of one per source. A template from scratch needs no project: earlier drafts could only make one by borrowing an unrelated project's ID, which also passed on that project's color and workspace.

The SDK keeps one method per backend route instead (`saveProjectAsTemplate` and `createTemplate`), since the routes take different inputs; the tools choose between them, as todoist-web does.

> **Note:** Renaming or removing these tools is a breaking change. Callers that use the old names stop working. See open question 1.

### No CSV in `create-project-from-template`

`create-project-from-template` only takes a template, not CSV content, so it does not use `POST /projects/import`. To start a new project from CSV, create the project with `add-projects` and then call `import-into-project`.

### Dropping the shareable download link (pending Doist/Issues#21076)

**Proposed, waiting on Product in Doist/Issues#21076**, which asks whether to restore the link in the apps or drop it from the MCP. Until then, `export-project-as-csv` (#707) keeps the `format: "url"` option of `export-project-template`, which uploads the project's CSV and returns a link to it (`GET /templates/url`), and its description now says the link is public, permanent and can't be revoked. #713 drops the option, to merge only if that's the outcome. The case for dropping it:

- **The link is public, unauthenticated and permanent.** Users have no way to see or revoke the links they create; removing one takes a manual request to Platform.
- **No Todoist app creates these links anymore.** The web app removed "Export as shareable URL" on purpose in Doist/todoist-web#11771, and no Todoist app calls the route. Only the MCP and todoist-cli's `td template export-url` still do. The MCP created links about 1,166 times for 222 users in the 14 days before 2026-10-21.
- **The current tool doesn't warn about any of this.** Its description suggests the link for large projects without saying it is public. Its annotations mark it read-only, so clients can run it without asking the user.

Without the link, `export-project-as-csv` would persist nothing and be read-only.

If the link goes, the fix covers todoist-cli too: `td template export-url` is removed, so no Doist client creates these links. `td template export-file` keeps returning the CSV itself.

## Drafts before saving

Creating a template works like todoist-web: the user sees the draft, and can edit it, before the template exists. A template never exists with content the user didn't want, which matters because the public API can't delete one.

- **The draft comes first.** `preview` defaults to `true` on `create-template`, so a call returns the draft content and saves nothing: a blank draft with no request at all, `GET /templates/preview` for a project, `POST /templates/user/preview` for CSV (which stages the upload but creates no template), or an outline of content the agent wrote.
- **The agent asks the user.** The draft response tells the agent to show the user the draft and ask whether to change anything before saving. If the user already said to save it as it is, the agent skips the draft and saves in one call.
- The draft has the same shape as `get-template`'s content, so the model can show it, edit it, and send it back.
- **`preview: false` saves.** With `content`, it saves the draft: `POST /templates/user` with the project ID, or `POST /templates/user/import` without one, which takes content alone. Without `content`, it saves the project or the CSV as they are.
- **Workspace and sharing come after saving**, as in todoist-web: the template is created, then `updateTemplate` sets its workspace and sharing. If that follow-up fails, the tool reports the template as created, with the error, rather than throwing. Saving a project into its own workspace uses `forWorkspace` instead, which keeps its assignees.
- Eval scenarios check that a first call doesn't save unless the user asked to save as is (`save-template-shows-draft`, `save-template-as-is`, `csv-template-shows-draft`), and that a template from scratch doesn't borrow a project (`template-from-scratch`).
- MCP elicitation, where the server asks the user directly with buttons, isn't used: client support varies, and the user can answer in their own words, such as "drop the comments".
- `content` is fully typed in the input of `create-template` and `update-template`, so a client rejects malformed content before the call. That costs tokens in every conversation; see the migration notes.

## Editing template content

`get-template` and `update-template` edit a saved template's content the way todoist-web's template editor does: read the whole content, change it, and send all of it back. The backend replaces the content as a whole, so anything left out is removed.

- **Dates keep their time and timezone.** The SDK calls the saved-template routes on API v1.6, as todoist-web does (Doist/Todoist#30691). From that version, dates are read and written as complete objects (`date`, `string`, `lang`, `isRecurring`, `timezone`), so a resave keeps a due date's type, time and timezone. On API v1 they could only be sent as text, and resaving a template edited in todoist-web would have dropped them. A new date can still be just the text, e.g. `{ "string": "every friday at 10am" }`.
- **The reply reports what changed.** `update-template` reads the content before and after saving, and reports layout, sections, tasks, assigned tasks and comments, e.g. "tasks 3 → 2". It compares against what the backend stored, so changes the backend makes on save show up too.
- **What the backend changes on save:**
    - **Task IDs** are generated again on every save, so the model reads the content again before each edit.
    - **Assignees who aren't members of the template's workspace** are dropped.
    - **Reminders** aren't part of template content, so tasks created from a template have none.
- **No plan check on the layout.** The template routes don't check whether the workspace's plan includes a layout: a template in a Starter workspace can be saved with the Calendar layout, which Starter doesn't include. The plan is enforced when the template is used: a project created from it in that workspace gets the List layout. todoist-web checks this in its editor; the check belongs in the backend, where it would cover every client.

## todoist-cli

The CLI follows the same split, with the app's wording ("Export as CSV", "Import from CSV", "Save as template"). Commands live under what they act on: anything that changes or reads a project is under `td project`, and `td template` is only for templates themselves. "Template" is never used for CSV.

| Command                                             | What it does                                 | Replaces                  |
| --------------------------------------------------- | -------------------------------------------- | ------------------------- |
| `td project export-as-csv [ref]`                    | Exports a project as a CSV file.             | `td template export-file` |
| `td project save-as-template [ref]`                 | Saves a project as a template.               | New                       |
| `td project import [ref] --from-csv <path>`         | Imports a CSV file into an existing project. | `td template import-file` |
| `td project import [ref] --from-template <id>`      | Imports a template into an existing project. | `td template import-id`   |
| `td project create --name <name> --from-csv <path>` | Creates a project from a CSV file.           | `td template create`      |
| `td project create --from-template <id>`            | Creates a project from a template.           | New                       |
| `td template create --from-csv <path>`              | Creates a template from a CSV file.          | New                       |

The MCP's `create-template` covers both `td project save-as-template` and `td template create --from-csv`. The CLI keeps two commands, because a CLI command lives under what it acts on, and a template from scratch isn't planned there.
| `td template list` / `view` / `update` / `delete` | Finds, views, edits or deletes saved templates. `delete` waits on the backend route. | New, later |

`td template export-url` is removed if the link is dropped (see "Dropping the shareable download link").

- **Options per source.** `td project import` needs exactly one `--from-…` option. `--file-name` only applies with `--from-csv` and `--locale` only with `--from-template`. With `--from-…`, `td project create` rejects the options its routes don't accept (`--color`, `--favorite`, `--parent`, `--description`), pointing to `td project update` instead of ignoring them. `--workspace` and `--folder` are new for `--from-template`.
- **Help text.** `td template --help` points to `td project import --from-template` and `td project create --from-template`, since someone thinking "templates" looks there first. Wording that calls the CSV a template ("CSV template file", "Template written to", "Exporting template...") changes to CSV.
- **Old command names.** The renames break scripts, so the old commands stay for one release as hidden aliases that print a deprecation warning. Unlike in the MCP, this costs nothing.
- **Read-only mode.** `src/lib/permissions.ts` lists read-only SDK methods by name, so the renamed `exportProjectAsCSV` must be added there, or read-only logins get blocked from exporting.

## Out of scope

- **Setup templates.** A setup template creates several projects plus labels and filters (`POST /templates/{template_id}/use`). These tools handle project templates only. `create-project-from-template` rejects a setup template, because `POST /projects/from_template` does not support them.
- **Previewing a template before using it.** `get-template` returns a template's content so the model can edit it with `update-template`, and it also shows what a template contains, so no separate preview tool is planned.
- **A `create-project-from-csv` tool.** `POST /projects/import` creates a new project from CSV in one call, but it only takes a name and a workspace. Calling `add-projects` and then `import-into-project` can also set the color, view style, parent project and folder, and goes through `add-projects`' personal project limit check, without adding another tool to every conversation's token cost. The two calls are not atomic: if the import fails, the new project is left empty, so `import-into-project` should name that project in its error. Revisit if models struggle with the two steps.

## Migration notes

- **The current import tool uses routes that are being retired.** `import-project-template` calls `templates/import_into_project_from_template_id` and `templates/import_into_project_from_file`. The backend spec gates both behind the `RESTFUL_TEMPLATES` API increment, and returns `410 Gone` to clients on that increment or later. `import-into-project` calls the new `/projects/{project_id}/…` routes through the SDK methods `importCSVIntoProject` and `importTemplateFromId`. Doist/todoist-sdk-typescript#749 moves both methods to those routes without changing them, as a patch release. Doist/todoist-sdk-typescript#750 then renames the CSV method from `importTemplateIntoProject` to `importCSVIntoProject`, as a major release. `GET /templates/file` keeps its path, so `export-project-as-csv` is unaffected.
- **Saved-template routes move to API v1.6.** The SDK calls `/templates/user/*` and template content on v1.6, as todoist-web does, and every other route on v1 (Doist/todoist-sdk-typescript#746, Doist/todoist-sdk-typescript#748 and Doist/todoist-sdk-typescript#751). Saving a project as a template on v1 also loses date details, because the backend's export of the project into the template drops them.
- **Renaming tools is a breaking change for clients.** Any saved prompt, agent configuration or client allowlist that names `export-project-template` or `import-project-template` stops working. Whether and how to rename is open question 1.
- **Per-tool bookkeeping.** Each new or renamed tool needs entries in `src/utils/tool-names.ts`, `src/tool-registry.ts`, `src/index.ts` and `src/tools/tool-annotations.test.ts`. The routing guidance in `src/mcp-server.ts` changes too, and `src/token-footprint.test.ts` needs a higher budget: the template tools stack raises it from 36,400 to 40,200 tokens, most of it for the typed `content` input in `create-template` and `update-template`. The import and export stack raises it to 36,500 for the link's warning, and #713 lowers it to 36,200 if the link goes; `import-into-project` costs the same as the tool it replaces.
- **Annotations.** Following the rules in `AGENTS.md`:
    - `export-project-as-csv` keeps the old tool's hints while it can create a link: not read-only, and open-world. Without the link (#713), it is read-only, since returning CSV content persists nothing.
    - `import-into-project` and `create-project-from-template` are additive writes: not read-only, not destructive, not idempotent.
    - `create-template` is an additive write, and not idempotent, since each call saves a new template. It is open-world, because it can share the new template with workspace members.
    - `update-template` is destructive, because replacing content overwrites it and unsharing removes members' access. It is idempotent, and open-world because sharing shows the template to other workspace members.
    - `find-templates` is read-only.
    - `delete-template` is destructive.

## Open questions

1. **How do we ship the renames?** The drafts rename outright, as breaking changes (#707, #708); to confirm with the team. Options:
    - Rename in one release marked as breaking (`feat!`), so semantic-release bumps the major version. Simplest, but callers using the old names break on upgrade.
    - Keep the old names for one release as deprecated duplicates of the new tools, then remove them. Gives callers time to switch, but both sets of tools count against the token budget in the meantime.
2. **Do we drop the shareable download link?** Waiting on Product in Doist/Issues#21076: restore the link in the apps, or drop it from the MCP and todoist-cli. #707 keeps it with a warning, and #713 drops it if that's the outcome. See "Dropping the shareable download link".
