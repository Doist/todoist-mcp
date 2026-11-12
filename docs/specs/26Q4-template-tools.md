# Template tools

Status: draft · Owner: Francesca Guiducci · Last updated: 2026-11-12

## Goal

Offer the Todoist template features from the web app through the MCP, built on the public template API ([RESTful Template API spec](https://github.com/Doist/specs/blob/main/Backend/restful-template-api.md); Doist/Todoist#30739, Doist/Todoist#30740, Doist/Todoist#30742, Doist/Todoist#30743, Doist/Todoist#30744, Doist/Todoist#31042).

Today the server has two template tools, added in #555:

- `export-project-template` returns a project as CSV content or as a shareable download URL.
- `import-project-template` adds a template to an existing project, taken either from a template ID/URL or from CSV content. To start a new project from a template, the model has to call `add-projects` first and then import into it.

## Tools

| Tool                           | What it does                                                                                                                                                                                                     | Replaces                                            | API route                                                              | SDK method                                                                                                | Status                                                                                         |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `export-project-as-csv`        | Returns a project as CSV content. No shareable download link (see below).                                                                                                                                        | `export-project-template`                           | `GET /templates/file`                                                  | `exportProjectAsCSV` (Doist/todoist-sdk-typescript#750; `exportTemplateAsFile` until then)                | Not started                                                                                    |
| `save-project-as-template`     | Saves a project as a reusable template in the user's Todoist, like the app's "Save as template". Projects only. Returns the draft first by default; `preview: false` saves it, with `content` if it was edited.  | —                                                   | `GET /templates/preview`, `POST /templates/user`                       | `previewProjectAsTemplate`, `saveProjectAsTemplate` (Doist/todoist-sdk-typescript#746)                    | Drafted in #695                                                                                |
| `create-template-from-csv`     | Creates a personal template from CSV content, as todoist-web can. Task assignees are dropped. Returns the draft first by default; `preview: false` creates it, with `content` if it was edited.                  | —                                                   | `POST /templates/user/preview`, `POST /templates/user/import`          | `previewTemplateFromCSV`, `createTemplateFromCSV` (Doist/todoist-sdk-typescript#748)                      | Drafted in #679                                                                                |
| `import-csv-into-project`      | Adds CSV content to an existing project. CSV only.                                                                                                                                                               | The CSV half of `import-project-template`           | `POST /projects/{project_id}/import`                                   | `importCSVIntoProject` (Doist/todoist-sdk-typescript#750)                                                 | SDK route move in Doist/todoist-sdk-typescript#749, rename in Doist/todoist-sdk-typescript#750 |
| `import-template-into-project` | Adds a gallery or saved template to an existing project, by template ID or URL.                                                                                                                                  | The template-ID half of `import-project-template`   | `POST /projects/{project_id}/import_template`                          | `importTemplateFromId` (Doist/todoist-sdk-typescript#749)                                                 | SDK route move drafted in Doist/todoist-sdk-typescript#749                                     |
| `create-project-from-template` | Creates a new project from a gallery or saved template, by template ID or URL. Templates only, not CSV content.                                                                                                  | The `add-projects` then import workaround from #555 | `POST /projects/from_template`                                         | `createProjectFromTemplateId` (Doist/todoist-sdk-typescript#746)                                          | Drafted in #665                                                                                |
| `update-template`              | Renames a saved template, changes its description or color, edits its content (layout, sections, tasks, comments) or replaces it from a project, moves it into a workspace, or shares it with workspace members. | —                                                   | `PUT /templates/user/{template_id}`                                    | `updateTemplate` (Doist/todoist-sdk-typescript#748), with `content` in Doist/todoist-sdk-typescript#751   | Drafted in #666; content editing in #680                                                       |
| `get-template`                 | Returns a template's details and full content (layout, sections, tasks, comments), in the shape `update-template` takes back. Read-only.                                                                         | New                                                 | `GET /templates/{template_id}`, `GET /templates/{template_id}/preview` | `getTemplate` (Doist/todoist-sdk-typescript#747), `getTemplateContent` (Doist/todoist-sdk-typescript#751) | Drafted in #680                                                                                |
| `find-templates`               | Searches gallery, personal and workspace templates, so the model can find a template without the user supplying its ID.                                                                                          | —                                                   | `GET /templates`, `GET /templates/{template_id}`                       | `getTemplates`, `getTemplate` (Doist/todoist-sdk-typescript#747)                                          | Not started                                                                                    |
| `delete-template`              | Deletes a saved template.                                                                                                                                                                                        | —                                                   | `DELETE /templates/user/{template_id}`                                 | None                                                                                                      | Blocked: the route is still private. Backend has been asked to publish it.                     |

`export-project-template` and `import-project-template` are removed once their replacements ship.

> **Note:** Renaming or removing these tools is a breaking change. Callers that use the old names stop working. See open question 1.

### No CSV in `create-project-from-template`

`create-project-from-template` only takes a template, not CSV content, so it does not use `POST /projects/import`. To start a new project from CSV, create the project with `add-projects` and then call `import-csv-into-project`.

### Dropping the shareable download link

`export-project-as-csv` returns CSV content only. It drops the `format: "url"` option of `export-project-template`, which uploads the project's CSV and returns a link to it (`GET /templates/url`). Discussed in Doist/Issues#21076:

- **The link is public, unauthenticated and permanent.** Users have no way to see or revoke the links they create; removing one takes a manual request to Platform.
- **No Todoist app creates these links anymore.** The web app removed "Export as shareable URL" on purpose in Doist/todoist-web#11771, and no Todoist app calls the route. Only the MCP and todoist-cli's `td template export-url` still do. The MCP created links about 1,166 times for 222 users in the 14 days before 2026-10-21.
- **The current tool doesn't warn about any of this.** Its description suggests the link for large projects without saying it is public. Its annotations mark it read-only, so clients can run it without asking the user.

Without the link, `export-project-as-csv` persists nothing and is read-only.

The fix covers todoist-cli too: `td template export-url` is removed, so no Doist client creates these links. `td template export-file` keeps returning the CSV itself.

## Drafts before saving

Saving a project as a template and creating one from CSV work like todoist-web: the user sees the draft, and can edit it, before the template exists. A template never exists with content the user didn't want, which matters because the public API can't delete one.

- **The draft comes first.** `preview` defaults to `true` on `save-project-as-template` and `create-template-from-csv`, so a call returns the draft content and saves nothing: `GET /templates/preview` for a project, `POST /templates/user/preview` for CSV, which stages the upload but creates no template.
- **The agent asks the user.** The draft response tells the agent to show the user the draft and ask whether to change anything before saving. If the user already said to save it as it is, the agent skips the draft and saves in one call.
- The draft has the same shape as `get-template`'s content, so the model can show it, edit it, and send it back.
- **`preview: false` saves.** With `content`, it saves the edited draft: `POST /templates/user` with the project ID, or `POST /templates/user/import`. Without `content`, it saves the project or the CSV as they are. `content` without `preview: false` is an error, so nothing is saved by accident.
- Eval scenarios check that a first call doesn't save unless the user asked to save as is (`save-template-shows-draft`, `save-template-as-is`, `csv-template-shows-draft`).
- MCP elicitation, where the server asks the user directly with buttons, isn't used: client support varies, and the user can answer in their own words, such as "drop the comments".
- `content` is fully typed in each tool's input, so a client rejects malformed content before the call. That costs tokens in every conversation; see the migration notes.

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

| Command                                             | What it does                                                                         | Replaces                  |
| --------------------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------- |
| `td project export-as-csv [ref]`                    | Exports a project as a CSV file.                                                     | `td template export-file` |
| `td project save-as-template [ref]`                 | Saves a project as a template.                                                       | New                       |
| `td project import [ref] --from-csv <path>`         | Imports a CSV file into an existing project.                                         | `td template import-file` |
| `td project import [ref] --from-template <id>`      | Imports a template into an existing project.                                         | `td template import-id`   |
| `td project create --name <name> --from-csv <path>` | Creates a project from a CSV file.                                                   | `td template create`      |
| `td project create --from-template <id>`            | Creates a project from a template.                                                   | New                       |
| `td template create --from-csv <path>`              | Creates a template from a CSV file.                                                  | New                       |
| `td template list` / `view` / `update` / `delete`   | Finds, views, edits or deletes saved templates. `delete` waits on the backend route. | New, later                |

`td template export-url` is removed (see "Dropping the shareable download link").

- **Options per source.** `td project import` needs exactly one `--from-…` option. `--file-name` only applies with `--from-csv` and `--locale` only with `--from-template`. With `--from-…`, `td project create` rejects the options its routes don't accept (`--color`, `--favorite`, `--parent`, `--description`), pointing to `td project update` instead of ignoring them. `--workspace` and `--folder` are new for `--from-template`.
- **Help text.** `td template --help` points to `td project import --from-template` and `td project create --from-template`, since someone thinking "templates" looks there first. Wording that calls the CSV a template ("CSV template file", "Template written to", "Exporting template...") changes to CSV.
- **Old command names.** The renames break scripts, so the old commands stay for one release as hidden aliases that print a deprecation warning. Unlike in the MCP, this costs nothing.
- **Read-only mode.** `src/lib/permissions.ts` lists read-only SDK methods by name, so the renamed `exportProjectAsCSV` must be added there, or read-only logins get blocked from exporting.

## Out of scope

- **Setup templates.** A setup template creates several projects plus labels and filters (`POST /templates/{template_id}/use`). These tools handle project templates only. `create-project-from-template` rejects a setup template, because `POST /projects/from_template` does not support them.
- **Previewing a template before using it.** `get-template` returns a template's content so the model can edit it with `update-template`, and it also shows what a template contains, so no separate preview tool is planned.
- **A `create-project-from-csv` tool.** `POST /projects/import` creates a new project from CSV in one call, but it only takes a name and a workspace. Calling `add-projects` and then `import-csv-into-project` can also set the color, view style, parent project and folder, and goes through `add-projects`' personal project limit check, without adding another tool to every conversation's token cost. The two calls are not atomic: if the import fails, the new project is left empty, so `import-csv-into-project` should name that project in its error. Revisit if models struggle with the two steps.

## Migration notes

- **The current import tool uses routes that are being retired.** `import-project-template` calls `templates/import_into_project_from_template_id` and `templates/import_into_project_from_file`. The backend spec gates both behind the `RESTFUL_TEMPLATES` API increment, and returns `410 Gone` to clients on that increment or later. The two import tools call the new `/projects/{project_id}/…` routes through the SDK methods `importCSVIntoProject` and `importTemplateFromId`. Doist/todoist-sdk-typescript#749 moves both methods to those routes without changing them, as a patch release. Doist/todoist-sdk-typescript#750 then renames the CSV method from `importTemplateIntoProject` to `importCSVIntoProject`, as a major release. `GET /templates/file` keeps its path, so `export-project-as-csv` is unaffected.
- **Saved-template routes move to API v1.6.** The SDK calls `/templates/user/*` and template content on v1.6, as todoist-web does, and every other route on v1 (Doist/todoist-sdk-typescript#746, Doist/todoist-sdk-typescript#748 and Doist/todoist-sdk-typescript#751). Saving a project as a template on v1 also loses date details, because the backend's export of the project into the template drops them.
- **Renaming tools is a breaking change for clients.** Any saved prompt, agent configuration or client allowlist that names `export-project-template` or `import-project-template` stops working. Whether and how to rename is open question 1.
- **Per-tool bookkeeping.** Each new or renamed tool needs entries in `src/utils/tool-names.ts`, `src/tool-registry.ts`, `src/index.ts` and `src/tools/tool-annotations.test.ts`. The routing guidance in `src/mcp-server.ts` changes too, and `src/token-footprint.test.ts` needs a higher budget: the tools drafted so far raise it from 36,400 to 40,900 tokens, about 2,000 of that for the typed `content` input in `save-project-as-template`, `create-template-from-csv` and `update-template`.
- **Annotations.** Following the rules in `AGENTS.md`:
    - `export-project-as-csv` is read-only, since returning CSV content persists nothing.
    - The import tools and `create-project-from-template` are additive writes: not read-only, not destructive, not idempotent.
    - `save-project-as-template` is an additive write, and not idempotent, since each call saves a new template. It is not open-world: workspace templates start unshared.
    - `create-template-from-csv` is an additive write, and not idempotent, since each call creates a new template.
    - `update-template` is destructive, because replacing content overwrites it and unsharing removes members' access. It is idempotent, and open-world because sharing shows the template to other workspace members.
    - `find-templates` is read-only.
    - `delete-template` is destructive.

## Open questions

1. **How do we ship the renames?** Leaning towards renaming; to confirm with the team. Options:
    - Rename in one release marked as breaking (`feat!`), so semantic-release bumps the major version. Simplest, but callers using the old names break on upgrade.
    - Keep the old names for one release as deprecated duplicates of the new tools, then remove them. Gives callers time to switch, but both sets of tools count against the token budget in the meantime.
