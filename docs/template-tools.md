# Template tools

Status: draft · Owner: Francesca Guiducci · Last updated: 2026-11-05

## Goal

Offer the Todoist template features from the web app through the MCP, built on the public template API ([RESTful Template API spec](https://github.com/Doist/specs/blob/main/Backend/restful-template-api.md); Doist/Todoist#30739, Doist/Todoist#30740, Doist/Todoist#30742, Doist/Todoist#30743, Doist/Todoist#30744, Doist/Todoist#31042).

Today the server has two template tools, added in #555:

- `export-project-template` returns a project as CSV content or as a shareable download URL.
- `import-project-template` adds a template to an existing project, taken either from a template ID/URL or from CSV content. To start a new project from a template, the model has to call `add-projects` first and then import into it.

## Tools

| Tool                           | What it does                                                                                                                                                     | Replaces                                            | API route                                             | SDK method                                                                                                               | Status                                                                     |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| `save-project-as-csv`          | Returns a project as CSV template content. No shareable download link (see below).                                                                               | `export-project-template`                           | `GET /templates/file`                                 | `exportTemplateAsFile` (exists)                                                                                          | Not started                                                                |
| `import-csv-into-project`      | Adds CSV template content to an existing project. CSV only.                                                                                                      | The CSV half of `import-project-template`           | `POST /projects/{project_id}/import`                  | `importTemplateIntoProject` (Doist/todoist-sdk-typescript#749)                                                           | SDK route move drafted in Doist/todoist-sdk-typescript#749                 |
| `import-template-into-project` | Adds a gallery or saved template to an existing project, by template ID or URL.                                                                                  | The template-ID half of `import-project-template`   | `POST /projects/{project_id}/import_template`         | `importTemplateFromId` (Doist/todoist-sdk-typescript#749)                                                                | SDK route move drafted in Doist/todoist-sdk-typescript#749                 |
| `create-project-from-template` | Creates a new project from a gallery or saved template, by template ID or URL. Templates only, not CSV content.                                                  | The `add-projects` then import workaround from #555 | `POST /projects/from_template`                        | `createProjectFromTemplateId` (Doist/todoist-sdk-typescript#746)                                                         | Drafted in #665                                                            |
| `save-project-as-template`     | Saves a project, or CSV content, as a reusable template in the user's Todoist, like the app's "Save as template".                                                | —                                                   | `POST /templates/user`, `POST /templates/user/import` | `createUserTemplate` (Doist/todoist-sdk-typescript#746), `createUserTemplateFromFile` (Doist/todoist-sdk-typescript#748) | Drafted in #665 and #666                                                   |
| `update-template`              | Renames a saved template, changes its description or color, replaces its content from a project, moves it into a workspace, or shares it with workspace members. | —                                                   | `PUT /templates/user/{template_id}`                   | `updateUserTemplate` (Doist/todoist-sdk-typescript#748)                                                                  | Drafted in #666                                                            |
| `find-templates`               | Searches gallery, personal and workspace templates, so the model can find a template without the user supplying its ID.                                          | —                                                   | `GET /templates`, `GET /templates/{template_id}`      | `getTemplates`, `getTemplate` (Doist/todoist-sdk-typescript#747)                                                         | Not started                                                                |
| `delete-template`              | Deletes a saved template.                                                                                                                                        | —                                                   | `DELETE /templates/user/{template_id}`                | None                                                                                                                     | Blocked: the route is still private. Backend has been asked to publish it. |

`export-project-template` and `import-project-template` are removed once their replacements ship.

> **Note:** Renaming or removing these tools is a breaking change. Callers that use the old names stop working. See open question 1.

### No CSV in `create-project-from-template`

`create-project-from-template` only takes a template, not CSV content, so it does not use `POST /projects/import`. To start a new project from CSV, create the project with `add-projects` and then call `import-csv-into-project`.

### Dropping the shareable download link

`save-project-as-csv` returns CSV content only. It drops the `format: "url"` option of `export-project-template`, which uploads the project's CSV and returns a link to it (`GET /templates/url`). Discussed in Doist/Issues#21076:

- **The link is public, unauthenticated and permanent.** Users have no way to see or revoke the links they create; removing one takes a manual request to Platform.
- **The MCP is the only place that still creates these links.** The web app removed "Export as shareable URL" on purpose in Doist/todoist-web#11771, and no Todoist app calls the route. The MCP created links about 1,166 times for 222 users in the 14 days before 2026-10-21.
- **The current tool doesn't warn about any of this.** Its description suggests the link for large projects without saying it is public. Its annotations mark it read-only, so clients can run it without asking the user.

Without the link, `save-project-as-csv` persists nothing and is read-only.

## Out of scope

- **Setup templates.** A setup template creates several projects plus labels and filters (`POST /templates/{template_id}/use`). These tools handle project templates only. `create-project-from-template` rejects a setup template, because `POST /projects/from_template` does not support them.
- **Template previews.** There is no tool to preview what a template contains before using it (`GET /templates/{template_id}/preview`). `find-templates` returns each template's name and description.

## Migration notes

- **The current import tool uses routes that are being retired.** `import-project-template` calls `templates/import_into_project_from_template_id` and `templates/import_into_project_from_file`. The backend spec gates both behind the `RESTFUL_TEMPLATES` API increment, and returns `410 Gone` to clients on that increment or later. The two import tools call the new `/projects/{project_id}/…` routes through the existing SDK methods `importTemplateIntoProject` (CSV) and `importTemplateFromId`, which Doist/todoist-sdk-typescript#749 moves to those routes without changing their arguments or responses. `GET /templates/file` keeps its path, so `save-project-as-csv` is unaffected.
- **Renaming tools is a breaking change for clients.** Any saved prompt, agent configuration or client allowlist that names `export-project-template` or `import-project-template` stops working. Whether and how to rename is open question 1.
- **Per-tool bookkeeping.** Each new or renamed tool needs entries in `src/utils/tool-names.ts`, `src/tool-registry.ts`, `src/index.ts` and `src/tools/tool-annotations.test.ts`. The routing guidance in `src/mcp-server.ts` changes too, and `src/token-footprint.test.ts` may need a higher budget.
- **Annotations.** Following the rules in `CLAUDE.md`:
    - `save-project-as-csv` is read-only, since returning CSV content persists nothing.
    - The import tools and `create-project-from-template` are additive writes: not read-only, not destructive, not idempotent.
    - `save-project-as-template` is an additive write, and not idempotent, since each call saves a new template. It is not open-world: workspace templates start unshared.
    - `update-template` is destructive, because replacing content overwrites it and unsharing removes members' access. It is idempotent, and open-world because sharing shows the template to other workspace members.
    - `find-templates` is read-only.
    - `delete-template` is destructive.

## Open questions

1. **How do we ship the renames?** Leaning towards renaming; to confirm with the team. Options:
    - Rename in one release marked as breaking (`feat!`), so semantic-release bumps the major version. Simplest, but callers using the old names break on upgrade.
    - Keep the old names for one release as deprecated duplicates of the new tools, then remove them. Gives callers time to switch, but both sets of tools count against the token budget in the meantime.
