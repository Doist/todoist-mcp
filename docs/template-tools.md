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
| `save-project-as-csv`          | Returns a project as CSV template content.                                                                                                                       | `export-project-template`                           | `GET /templates/file`                                 | `exportTemplateAsFile` (exists)                                                                                          | Not started                                                                |
| `import-csv-into-project`      | Adds CSV template content to an existing project. CSV only.                                                                                                      | The CSV half of `import-project-template`           | `POST /projects/{project_id}/import`                  | Not in the SDK yet                                                                                                       | Needs the SDK method                                                       |
| `import-template-into-project` | Adds a gallery or saved template to an existing project, by template ID or URL.                                                                                  | The template-ID half of `import-project-template`   | `POST /projects/{project_id}/import_template`         | Not in the SDK yet                                                                                                       | Needs the SDK method                                                       |
| `create-project-from-template` | Creates a new project from a gallery or saved template, by template ID or URL.                                                                                   | The `add-projects` then import workaround from #555 | `POST /projects/from_template`                        | `createProjectFromTemplateId` (Doist/todoist-sdk-typescript#746)                                                         | Drafted in #665                                                            |
| `save-project-as-template`     | Saves a project, or CSV content, as a reusable template in the user's Todoist, like the app's "Save as template".                                                | —                                                   | `POST /templates/user`, `POST /templates/user/import` | `createUserTemplate` (Doist/todoist-sdk-typescript#746), `createUserTemplateFromFile` (Doist/todoist-sdk-typescript#748) | Drafted in #665 and #666                                                   |
| `update-template`              | Renames a saved template, changes its description or color, replaces its content from a project, moves it into a workspace, or shares it with workspace members. | —                                                   | `PUT /templates/user/{template_id}`                   | `updateUserTemplate` (Doist/todoist-sdk-typescript#748)                                                                  | Drafted in #666                                                            |
| `find-templates`               | Searches gallery, personal and workspace templates, so the model can find a template without the user supplying its ID.                                          | —                                                   | `GET /templates`, `GET /templates/{template_id}`      | `getTemplates`, `getTemplate` (Doist/todoist-sdk-typescript#747)                                                         | Not started                                                                |
| `delete-template`              | Deletes a saved template.                                                                                                                                        | —                                                   | `DELETE /templates/user/{template_id}`                | None                                                                                                                     | Blocked: the route is still private. Backend has been asked to publish it. |

`export-project-template` and `import-project-template` are removed once their replacements ship.

> **Note:** Renaming or removing these tools is a breaking change. Callers that use the old names stop working. See open question 5.

## Migration notes

- **The current import tool uses routes that are being retired.** `import-project-template` calls `templates/import_into_project_from_template_id` and `templates/import_into_project_from_file`. The backend spec gates both behind the `RESTFUL_TEMPLATES` API increment, and returns `410 Gone` to clients on that increment or later. The two import tools should call the new `/projects/{project_id}/…` routes, which needs two new SDK methods first. `GET /templates/file` keeps its path, so `save-project-as-csv` is unaffected.
- **Renaming tools is a breaking change for clients.** Any saved prompt, agent configuration or client allowlist that names `export-project-template` or `import-project-template` stops working. Whether and how to rename is open question 5.
- **Per-tool bookkeeping.** Each new or renamed tool needs entries in `src/utils/tool-names.ts`, `src/tool-registry.ts`, `src/index.ts` and `src/tools/tool-annotations.test.ts`. The routing guidance in `src/mcp-server.ts` changes too, and `src/token-footprint.test.ts` may need a higher budget.
- **Annotations.** Following the rules in `CLAUDE.md`:
    - `save-project-as-csv` is read-only, since returning CSV content persists nothing. If it keeps the shareable URL option (see open questions), it is not read-only and is open-world.
    - The import tools and `create-project-from-template` are additive writes: not read-only, not destructive, not idempotent.
    - `save-project-as-template` is an additive write, and not idempotent, since each call saves a new template. It is not open-world: workspace templates start unshared.
    - `update-template` is destructive, because replacing content overwrites it and unsharing removes members' access. It is idempotent, and open-world because sharing shows the template to other workspace members.
    - `find-templates` is read-only.
    - `delete-template` is destructive.

## Open questions

1. **Does `save-project-as-csv` keep the shareable URL option?** `export-project-template` can return a download link (`GET /templates/url`) instead of CSV content. The new name suggests CSV only. Dropping the link makes the tool read-only, but loses the option for large projects.
2. **Should `create-project-from-template` also accept CSV content?** `POST /projects/import` creates a new project from a CSV, which would remove the need to create a project and then import CSV into it.
3. **Setup templates.** `POST /templates/{template_id}/use` instantiates a setup template (several projects, plus labels and filters). Is this in scope, and if so, as part of `create-project-from-template` or as its own tool?
4. **Template previews.** `GET /templates/{template_id}/preview` shows what a template contains before using it. Is this worth a tool, or is `find-templates` enough?
5. **How do we ship the renames?** Leaning towards renaming; to confirm with the team. Options:
    - Rename in one release marked as breaking (`feat!`), so semantic-release bumps the major version. Simplest, but callers using the old names break on upgrade.
    - Keep the old names for one release as deprecated duplicates of the new tools, then remove them. Gives callers time to switch, but both sets of tools count against the token budget in the meantime.
