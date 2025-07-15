import type { TodoistApi } from '@doist/todoist-api-typescript'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { getMaxPaginatedResults } from '../utils/get-max-paginated-results.js'

const description =
    'Get all tasks from Todoist using a filter.\n\n' +
    'Filters are custom views for your tasks based on specific criteria. You can narrow down your lists according to task name, date, project, label, priority, date created, and more.\n\n' +
    "There are a range of symbols you can use to filter the tasks. For example, 'today' will get all tasks due today.\n\n" +
    'Here’s a rundown of some of the more advanced filters you can use in Todoist:\n\n' +
    'In order to create filters based on keywords, you can use `search`: followed by a keyword.\n' +
    '- See all tasks that contain the word "Meeting", use this: "search: Meeting"\n' +
    '- See all tasks that contain the word "Meeting" that are due today, use this: "search: Meeting & today"\n' +
    '- See all tasks that contain either the word "Meeting" or "Work", use this: "search: Meeting | search: Work"\n' +
    '- See all tasks that contain the word "email", use this: "search: email"\n' +
    '- See all tasks that contain web links, use this: "search: http"\n\n' +
    'Create a filter to either see or exclude sub-tasks in the view:\n' +
    '- See all sub-tasks, use this: "subtask"\n' +
    '- See all parent tasks while excluding their sub-tasks, use this: "!subtask"\n\n' +
    'See all tasks scheduled for a specific date:\n' +
    '- View all tasks scheduled for January 3rd, use this: "date: Jan 3"\n' +
    '- See all tasks dated before a specific date, use this: "date before: May 5" or "date before: 5/5"\n' +
    '- See all tasks dated after a specific date, use this: "date after: May 5" or "date after: 5/5"\n' +
    '- See all tasks scheduled within the next four hours and all overdue tasks, use this: "date before: +4 hours"\n' +
    '- See all tasks dated in the current working week, use this: "date before: sat"\n' +
    '- See all tasks that are dated for next week, use this: "(date: next week | date after: next week) & date before: 1 week after next week"\n' +
    '- See all tasks dated within the current calendar month, use this: "date before: first day"\n' +
    '- See active tasks dated yesterday, along with today\'s tasks listed below, use this: "date: yesterday, today"\n' +
    '- See all tasks that have no date associated with them, use this: "no date"\n' +
    '- See all tasks with a date assigned to them, use this: "!no date"\n' +
    '- See all tasks with a date and time assigned to them, use this: "!no date & !no time"\n' +
    '- See all tasks dated today and before a specific time, use this: "date: today & date before: today at 2pm"\n' +
    '- See all tasks that are overdue, use this: "Overdue" or "over due" or "od"\n' +
    '- See all tasks that are overdue and have had time assigned to them, along with all tasks dated today and with time assigned to them, use this: "overdue & !no time, date: today & !no time"\n' +
    '- See all tasks in your Inbox without a date, followed by a separate section with all your tasks that have dates set, but are not in your Inbox: "#Inbox & no due date, All & !#Inbox & !no due date"\n' +
    'You can write a date in any of these ways:\n' +
    '- Specific date: 10/5/2022, Oct 5th 2022\n' +
    '- Specific date and time: 10/5/2022 5pm, Oct 5th 5pm\n' +
    '- Relative date: today, tomorrow, yesterday, 3 days (dated in the next 3 days), -3 days (dated in the past 3 days)\n' +
    '- Days of the week: Monday, Tuesday, Sunday\n\n' +
    'Examples with deadlines:\n' +
    '- See all tasks with no deadlines, use this: "no deadline"\n' +
    '- See all tasks with a deadline, use this: "!no deadline"\n' +
    '- See all tasks with a deadline today, use this: "deadline: today"\n' +
    '- See all tasks with a deadline within the next 7 days: "deadline after: yesterday & deadline before: in 7 days"\n' +
    '- See all tasks with overdue deadlines: "deadline before: today"\n\n' +
    "Due takes into consideration the date and deadline fields. If a task has both, a date and deadline, due prioritizes the date. If the task does not have a date, due will check if the deadline matches filter criteria. If you don't use deadlines, due and date filters will return the same results.\n" +
    '- View all tasks due on January 3rd: "Jan 3"\n' +
    '- See all tasks that are due before a specific date, use this: "due before: May 5" or "due before: 5/5"\n' +
    '- See all tasks that are due after a specific date, use this: "due after: May 5" or "due after: 5/5"\n' +
    '- See all tasks due within the next four hours and all overdue tasks, use this: "due before: +4 hours"\n' +
    '- See all tasks that are due before the day you\'ve selected in Settings > General > Next week, use this: "due before: next week"\n' +
    '- See all tasks due in the current working week, use this: "due before: sat"\n' +
    '- See all tasks that are due next week, use this: "(due: next week, use this: due after: next week) & due before: 1 week after next week"\n' +
    '- See all tasks due within the current calendar month, use this: "due before: first day"\n' +
    '- See active tasks due yesterday, along with today\'s tasks listed below, use this: "due: yesterday, today"\n' +
    '- See all tasks that have no date or deadline associated with them, use this: "no due date"\n' +
    '- See all tasks due today and before a specific due time, use this: "today & due before: today at 2pm"\n' +
    '- See all tasks that are overdue and have had a specific time assigned to them, along with all tasks due today, but only with times, use this: "overdue & !no time, today & !no time"\n' +
    '- See all tasks in your Inbox without a date or deadline, followed by a separate section with all your tasks that are due, but are not in your Inbox, use this: "#Inbox & no due date, All & !#Inbox & !no due date"\n' +
    '- See all tasks due within the next 5 days, use this: "5 days" or "next 5 days"\n' +
    '- See all tasks that have a recurring date, use this: "recurring"\n' +
    '- See all tasks that either have a non-recurring date or no date at all assigned to them, use this: "!recurring"\n' +
    '- See all tasks with a date, but no due time, and which are not recurring, use this: "no time & !recurring"\n' +
    '- See all tasks with priority level 1, use this: "p1"\n' +
    '- See all tasks with priority level 2, use this: "p2"\n' +
    '- See all tasks with priority level 3, use this: "p3"\n' +
    '- See all tasks with no priority level (i.e. p4), use this: "No priority"\n' +
    '- See all tasks with the label ""email"", use this: "@email"\n' +
    '- See all tasks that don\'t have any labels, use this: "no labels"\n' +
    '- See all tasks in the “Work” project, use this: "#Work"\n' +
    '- See all tasks in the ""Work"" project and its sub-projects, use this: "##Work"\n' +
    '- See all tasks in the ""School"" project and its sub-projects, but exclude the ""Science"" project, use this: "##School & !#Science"\n' +
    '- See all tasks belonging to sections named ""Meetings"" across all projects, use this: "/Meetings"\n' +
    '- See all tasks belonging to the section ""Meetings"" in the project ""Work"", use this: "#Work & /Meetings"\n' +
    '- See all tasks not assigned to sections, use this: "!/*"\n' +
    '- See all tasks not assigned to sections, but excluding tasks in your Inbox, use this: "!/* & !#Inbox"\n' +
    '- See all tasks in the “My Projects” workspace, use this: workspace: "My projects"\n' +
    '- See all tasks of the projects in the ""Design team"" folder, use this: "##Design team"\n' +
    '- Only see tasks in the "Doist" workspace, use this: "workspace: Doist"\n' +
    '- See all tasks in the "Doist" and "Halist" workspaces, use this: "(workspace: Doist | workspace: Halist)"\n' +
    '- See all tasks created on a specific date, use this: "created: Jan 3 2023"\n' +
    '- See all tasks created more than 365 days ago, use this: "created before: -365 days"\n' +
    '- See all tasks created within the last 365 days, use this: "created after: -365 days"\n' +
    '- See all tasks created today, use this: "created: today"\n' +
    '- See all tasks that have been assigned to others, use this: "assigned to: others"\n' +
    '- See all tasks Steve Gray assigned, use this: "assigned by: Steve Gray"\n' +
    '- See all tasks that you assigned to others, use this: "assigned by: me"\n' +
    '- See all tasks that have been assigned to anyone (yourself and others), use this: "assigned"\n' +
    '- See all tasks in shared projects, use this: "shared"\n' +
    '- See all tasks in your Todoist, excluding those assigned to others, use this: "!assigned to: others"\n' +
    '- See all tasks that are due today and are also labeled @email, use this: "Today & @email"\n' +
    '- See all tasks that are labelled either @work or @office, use this: "@work | @office"\n' +
    '- See all tasks that are either due today or are overdue and are also in the “Work” project, use this: "(today | overdue) & #Work"\n' +
    '- See all tasks that are not assigned to anyone, use this: "!assigned"\n' +
    '- See all tasks that are due today but exclude tasks in the ""Work"" project, use this: "Today & !#Work"\n' +
    '- See all tasks that are due tomorrow in the “Homework” project, but exclude tasks with the @languages label, use this: "#Homework & tomorrow & !@languages"\n' +
    '- See all tasks with any label that starts with “home”, use this: "@home"*\n' +
    '- See all tasks assigned to anyone whose first name starts with an M and last name is Smith, use this: "assigned to: m* smith"\n' +
    '- See all tasks from projects which name ends with “work”, use this: "#*Work"\n' +
    '- See all tasks from sections that have the word ""Work"" in the name. For example, /Work Meetings, /Work Admin, and /Work Calls, use this: "Work"\n' +
    '- See all tasks that don\'t belong to any section, use this: "!/*"\n' +
    '- See all tasks that are overdue or due today that are in the “Work” project, use this: "(today | overdue) & #Work"\n' +
    '- See all tasks that don\'t have a due time, use this: "no time"\n' +
    '- See all tasks that are due in the next 7 days and are labeled @waiting, use this: "7 days & @waiting"\n' +
    '- See all tasks created more than 365 days ago, use this: "created before: -365 days"\n' +
    '- See all tasks you assigned to others, use this: "assigned by: me"\n' +
    '- See all tasks assigned to Becky, use this: "assigned to: Becky"\n' +
    '- See all tasks created by you, use this: "added by: me"\n' +
    '- See all tasks created by Becky, use this: "added by: Becky"\n' +
    '- See all tasks in shared projects that haven’t been assigned to anyone, use this: "shared & !assigned"\n' +
    '- See all sub-tasks, use this: "subtask"\n' +
    '- See all parent tasks, use this: "!subtask"\n' +
    '- See all tasks, use this: "view all"\n' +
    '- See all tasks due within the next 8 hours, but exclude all overdue tasks, use this: "due before: +8 hours & !overdue"\n' +
    '- See every unscheduled task in your #Work project, use this: "#Work & no date"\n' +
    '- See every high-priority task in the next two weeks, use this: "(p1 &#124; p2) & 14 days"\n' +
    '- See tasks that were created more than 30 days ago, use this: "created before: -30 days"\n' +
    '- See all tasks with the label ""night"" that are scheduled for Saturday, use this: "Saturday & @night"\n' +
    '- See every task you’re assigned to in the project ""Work"", use this: "#Work & assigned to: me"\n' +
    '- See all uncompletable tasks (without a checkbox); note - this query will also include tasks using italic formatting, use this: "(search: *) & !(search: **) & !(search: ***)"\n'

export function registerGetTasksByFilter(server: McpServer, api: TodoistApi) {
    server.tool('get-tasks-by-filter', description, { filter: z.string() }, async ({ filter }) => {
        const tasks = await getMaxPaginatedResults((params) =>
            api.getTasksByFilter({ query: filter, ...params }),
        )
        return {
            content: tasks.map((task) => ({
                type: 'text',
                text: JSON.stringify(task, null, 2),
            })),
        }
    })
}
