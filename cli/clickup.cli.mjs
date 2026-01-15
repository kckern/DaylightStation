#!/usr/bin/env node

/**
 * ClickUp CLI - Interactive command-line interface for ClickUp
 * 
 * A comprehensive CLI tool for managing ClickUp tasks, lists, folders, and spaces.
 * Provides direct interaction with ClickUp API using the clickup.js library.
 * 
 * Usage:
 *   node clickup.cli.mjs [command] [options]
 * 
 * Commands:
 *   spaces              List all spaces
 *   folders <space>     List folders in a space
 *   lists <folder>      List lists in a folder
 *   tasks <list>        List tasks in a list
 *   task <id>           Get task details
 *   create <list>       Create a new task
 *   update <id>         Update a task
 *   delete <id>         Delete a task
 *   teams               List teams
 *   members <team>      List team members
 *   
 * @module cli/clickup
 */

import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import axios from '../backend/lib/http.mjs';
import { createLogger } from '../backend/lib/logging/logger.js';

const logger = createLogger({
    source: 'cli',
    app: 'clickup'
});

// Initialize ClickUp API configuration  
// Requires CLICKUP_PK environment variable
const apiToken = process.env.CLICKUP_PK;

if (!apiToken) {
    logger.error('ClickUp API token not found');
    console.error('❌ Error: CLICKUP_PK not found in environment');
    console.error('Please set CLICKUP_PK environment variable');
    process.exit(1);
}

logger.info('ClickUp client initialized');

/**
 * Make a ClickUp API request
 * @param {string} endpoint - API endpoint
 * @param {string} method - HTTP method
 * @param {Object} data - Request data
 * @returns {Promise<Object>} API response
 */
async function clickupRequest(endpoint, method = 'GET', data = null) {
    const url = `https://api.clickup.com/api/v2${endpoint}`;
    const config = {
        method,
        url,
        headers: { Authorization: apiToken }
    };
    
    if (data) {
        config.data = data;
    }
    
    try {
        const response = await axios(config);
        return response.data;
    } catch (error) {
        logger.error('ClickUp API error', { endpoint, error: error.message });
        throw error;
    }
}

/**
 * Format and display task information
 * @param {Object} task - Task object from ClickUp API
 */
function displayTask(task) {
    console.log(`\n📋 Task: ${task.name}`);
    console.log(`   ID: ${task.id}`);
    console.log(`   Status: ${task.status?.status || 'N/A'}`);
    console.log(`   Priority: ${task.priority?.priority || 'N/A'}`);
    console.log(`   Assignees: ${task.assignees?.map(a => a.username).join(', ') || 'None'}`);
    if (task.due_date) {
        console.log(`   Due: ${new Date(parseInt(task.due_date)).toLocaleString()}`);
    }
    if (task.description) {
        console.log(`   Description: ${task.description.substring(0, 100)}${task.description.length > 100 ? '...' : ''}`);
    }
    console.log(`   URL: ${task.url}`);
}

/**
 * Format and display list information
 * @param {Object} list - List object from ClickUp API
 */
function displayList(list) {
    console.log(`\n📝 List: ${list.name}`);
    console.log(`   ID: ${list.id}`);
    if (list.content) {
        console.log(`   Description: ${list.content}`);
    }
}

/**
 * Format and display folder information
 * @param {Object} folder - Folder object from ClickUp API
 */
function displayFolder(folder) {
    console.log(`\n📁 Folder: ${folder.name}`);
    console.log(`   ID: ${folder.id}`);
    console.log(`   Lists: ${folder.lists?.length || 0}`);
}

/**
 * Format and display space information
 * @param {Object} space - Space object from ClickUp API
 */
function displaySpace(space) {
    console.log(`\n🌐 Space: ${space.name}`);
    console.log(`   ID: ${space.id}`);
    console.log(`   Private: ${space.private ? 'Yes' : 'No'}`);
}

/**
 * List all teams
 */
async function listTeams() {
    try {
        logger.info('Fetching teams');
        const data = await clickupRequest('/team');
        
        console.log('\n👥 Teams:');
        console.log('='.repeat(50));
        
        data.teams.forEach(team => {
            console.log(`\n🏢 ${team.name}`);
            console.log(`   ID: ${team.id}`);
        });
        
        logger.info('Teams listed successfully', { count: data.teams.length });
    } catch (error) {
        logger.error('Failed to list teams', { error: error.message });
        console.error('❌ Error listing teams:', error.message);
        process.exit(1);
    }
}

/**
 * List team members
 * @param {string} teamId - Team ID
 */
async function listMembers(teamId) {
    try {
        logger.info('Fetching team members', { teamId });
        const data = await clickupRequest(`/team/${teamId}`);
        
        console.log('\n👤 Team Members:');
        console.log('='.repeat(50));
        
        data.team.members.forEach(member => {
            console.log(`\n${member.user.username}`);
            console.log(`   Email: ${member.user.email}`);
            console.log(`   Role: ${member.user.role}`);
        });
        
        logger.info('Members listed successfully', { count: data.team.members.length });
    } catch (error) {
        logger.error('Failed to list members', { teamId, error: error.message });
        console.error('❌ Error listing members:', error.message);
        process.exit(1);
    }
}

/**
 * List all spaces in a team
 * @param {string} teamId - Team ID
 */
async function listSpaces(teamId) {
    try {
        logger.info('Fetching spaces', { teamId });
        const data = await clickupRequest(`/team/${teamId}/space`);
        
        console.log('\n🌐 Spaces:');
        console.log('='.repeat(50));
        
        data.spaces.forEach(displaySpace);
        
        logger.info('Spaces listed successfully', { count: data.spaces.length });
    } catch (error) {
        logger.error('Failed to list spaces', { teamId, error: error.message });
        console.error('❌ Error listing spaces:', error.message);
        process.exit(1);
    }
}

/**
 * List folders in a space
 * @param {string} spaceId - Space ID
 */
async function listFolders(spaceId) {
    try {
        logger.info('Fetching folders', { spaceId });
        const data = await clickupRequest(`/space/${spaceId}/folder`);
        
        console.log('\n📁 Folders:');
        console.log('='.repeat(50));
        
        data.folders.forEach(displayFolder);
        
        logger.info('Folders listed successfully', { count: data.folders.length });
    } catch (error) {
        logger.error('Failed to list folders', { spaceId, error: error.message });
        console.error('❌ Error listing folders:', error.message);
        process.exit(1);
    }
}

/**
 * List lists in a folder
 * @param {string} folderId - Folder ID
 */
async function listLists(folderId) {
    try {
        logger.info('Fetching lists', { folderId });
        const data = await clickupRequest(`/folder/${folderId}/list`);
        
        console.log('\n📝 Lists:');
        console.log('='.repeat(50));
        
        data.lists.forEach(displayList);
        
        logger.info('Lists listed successfully', { count: data.lists.length });
    } catch (error) {
        logger.error('Failed to list lists', { folderId, error: error.message });
        console.error('❌ Error listing lists:', error.message);
        process.exit(1);
    }
}

/**
 * List tasks in a list
 * @param {string} listId - List ID
 */
async function listTasks(listId) {
    try {
        logger.info('Fetching tasks', { listId });
        const data = await clickupRequest(`/list/${listId}/task`);
        
        console.log('\n📋 Tasks:');
        console.log('='.repeat(50));
        
        data.tasks.forEach(displayTask);
        
        logger.info('Tasks listed successfully', { count: data.tasks.length });
    } catch (error) {
        logger.error('Failed to list tasks', { listId, error: error.message });
        console.error('❌ Error listing tasks:', error.message);
        process.exit(1);
    }
}

/**
 * Get task details
 * @param {string} taskId - Task ID
 */
async function getTask(taskId) {
    try {
        logger.info('Fetching task details', { taskId });
        const task = await clickupRequest(`/task/${taskId}`);
        
        console.log('\n📋 Task Details:');
        console.log('='.repeat(50));
        displayTask(task);
        
        if (task.tags && task.tags.length > 0) {
            console.log(`   Tags: ${task.tags.map(t => t.name).join(', ')}`);
        }
        
        if (task.custom_fields && task.custom_fields.length > 0) {
            console.log('\n   Custom Fields:');
            task.custom_fields.forEach(field => {
                console.log(`     - ${field.name}: ${field.value || 'N/A'}`);
            });
        }
        
        logger.info('Task details fetched successfully', { taskId });
    } catch (error) {
        logger.error('Failed to get task', { taskId, error: error.message });
        console.error('❌ Error getting task:', error.message);
        process.exit(1);
    }
}

/**
 * Create a new task
 * @param {string} listId - List ID where task will be created
 * @param {Object} taskData - Task data
 */
async function createTask(listId, taskData) {
    try {
        logger.info('Creating task', { listId, taskData });
        const task = await clickupRequest(`/list/${listId}/task`, 'POST', taskData);
        
        console.log('\n✅ Task created successfully!');
        displayTask(task);
        
        logger.info('Task created successfully', { taskId: task.id, listId });
        return task;
    } catch (error) {
        logger.error('Failed to create task', { listId, error: error.message });
        console.error('❌ Error creating task:', error.message);
        process.exit(1);
    }
}

/**
 * Update a task
 * @param {string} taskId - Task ID
 * @param {Object} updates - Task updates
 */
async function updateTask(taskId, updates) {
    try {
        logger.info('Updating task', { taskId, updates });
        const task = await clickupRequest(`/task/${taskId}`, 'PUT', updates);
        
        console.log('\n✅ Task updated successfully!');
        displayTask(task);
        
        logger.info('Task updated successfully', { taskId });
        return task;
    } catch (error) {
        logger.error('Failed to update task', { taskId, error: error.message });
        console.error('❌ Error updating task:', error.message);
        process.exit(1);
    }
}

/**
 * Delete a task
 * @param {string} taskId - Task ID
 */
async function deleteTask(taskId) {
    try {
        logger.info('Deleting task', { taskId });
        await clickupRequest(`/task/${taskId}`, 'DELETE');
        
        console.log('\n✅ Task deleted successfully!');
        logger.info('Task deleted successfully', { taskId });
    } catch (error) {
        logger.error('Failed to delete task', { taskId, error: error.message });
        console.error('❌ Error deleting task:', error.message);
        process.exit(1);
    }
}

/**
 * DaylightStation list configuration
 */
const DAYLIGHT_LISTS = {
    'TV View': '901607520316',
    'Finances': '24805956',
    'Home/Office': '901606966797',
    'Journalist / Lifelog': '901606966817',
    'Nutribot / Health': '901606966820',
    'Fitness': '901610284012',
    'System and Admin': '901612664297'
};

/**
 * Get all pending tasks across DaylightStation lists
 * Filters for 'ready' and 'in progress' statuses
 */
async function getPendingTasks() {
    try {
        logger.info('Fetching pending tasks across all DaylightStation lists');
        
        const inProgress = [];
        const ready = [];
        const onDeck = [];
        
        for (const [listName, listId] of Object.entries(DAYLIGHT_LISTS)) {
            const data = await clickupRequest(`/list/${listId}/task`);
            
            for (const task of data.tasks) {
                const status = task.status?.status?.toLowerCase() || '';
                const taskInfo = {
                    ...task,
                    listName,
                    listId
                };
                
                if (status === 'in progress') {
                    inProgress.push(taskInfo);
                } else if (status === 'ready') {
                    ready.push(taskInfo);
                } else if (status === 'on deck') {
                    onDeck.push(taskInfo);
                }
            }
        }
        
        console.log('\n📋 Pending Tasks - DaylightStation');
        console.log('='.repeat(60));
        
        if (inProgress.length > 0) {
            console.log('\n🔄 IN PROGRESS (continue implementation):');
            inProgress.forEach(task => {
                console.log(`   • ${task.name}`);
                console.log(`     ID: ${task.id} | List: ${task.listName}`);
                console.log(`     URL: ${task.url}`);
            });
        }
        
        if (onDeck.length > 0) {
            console.log('\n📝 ON DECK (needs design/PRD):');
            onDeck.forEach(task => {
                console.log(`   • ${task.name}`);
                console.log(`     ID: ${task.id} | List: ${task.listName}`);
                console.log(`     URL: ${task.url}`);
            });
        }
        
        if (ready.length > 0) {
            console.log('\n✅ READY (PR ready for review):');
            ready.forEach(task => {
                console.log(`   • ${task.name}`);
                console.log(`     ID: ${task.id} | List: ${task.listName}`);
                console.log(`     URL: ${task.url}`);
            });
        }
        
        if (inProgress.length === 0 && ready.length === 0 && onDeck.length === 0) {
            console.log('\n✨ No pending tasks! All caught up.');
        }
        
        console.log('\n' + '='.repeat(60));
        console.log(`Summary: ${inProgress.length} in progress, ${ready.length} ready, ${onDeck.length} on deck`);
        
        logger.info('Pending tasks fetched', { 
            inProgress: inProgress.length, 
            ready: ready.length,
            onDeck: onDeck.length 
        });
        
        return { inProgress, ready, onDeck };
    } catch (error) {
        logger.error('Failed to fetch pending tasks', { error: error.message });
        console.error('❌ Error fetching pending tasks:', error.message);
        process.exit(1);
    }
}

/**
 * Get comments for a task
 * @param {string} taskId - Task ID
 */
async function getComments(taskId) {
    try {
        logger.info('Fetching comments', { taskId });
        const data = await clickupRequest(`/task/${taskId}/comment`);
        
        console.log('\n💬 Comments:');
        console.log('='.repeat(50));
        
        if (data.comments.length === 0) {
            console.log('   No comments yet.');
        } else {
            data.comments.forEach(comment => {
                const date = new Date(parseInt(comment.date)).toLocaleString();
                console.log(`\n   📝 ${comment.user?.username || 'Unknown'} (${date}):`);
                // Handle comment text - it may have formatting
                const text = comment.comment_text || '';
                console.log(`   ${text.split('\n').join('\n   ')}`);
            });
        }
        
        logger.info('Comments fetched', { count: data.comments.length });
        return data.comments;
    } catch (error) {
        logger.error('Failed to fetch comments', { taskId, error: error.message });
        console.error('❌ Error fetching comments:', error.message);
        process.exit(1);
    }
}

/**
 * Add a comment to a task
 * @param {string} taskId - Task ID
 * @param {string} commentText - Comment content
 */
async function addComment(taskId, commentText) {
    try {
        logger.info('Adding comment', { taskId });
        const comment = await clickupRequest(`/task/${taskId}/comment`, 'POST', {
            comment_text: commentText
        });
        
        console.log('\n✅ Comment added successfully!');
        logger.info('Comment added', { taskId, commentId: comment.id });
        return comment;
    } catch (error) {
        logger.error('Failed to add comment', { taskId, error: error.message });
        console.error('❌ Error adding comment:', error.message);
        process.exit(1);
    }
}

/**
 * Interactive CLI prompt
 */
async function interactiveMode() {
    const readline = (await import('readline')).default;
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    const question = (prompt) => new Promise((resolve) => rl.question(prompt, resolve));

    console.log('\n🚀 ClickUp CLI - Interactive Mode');
    console.log('='.repeat(50));
    console.log('Available commands:');
    console.log('  teams         - List all teams');
    console.log('  spaces        - List spaces (requires team ID)');
    console.log('  folders       - List folders (requires space ID)');
    console.log('  lists         - List lists (requires folder ID)');
    console.log('  tasks         - List tasks (requires list ID)');
    console.log('  task          - Get task details (requires task ID)');
    console.log('  create        - Create a new task (requires list ID)');
    console.log('  update        - Update a task (requires task ID)');
    console.log('  delete        - Delete a task (requires task ID)');
    console.log('  exit          - Exit interactive mode');
    console.log('='.repeat(50));

    let running = true;
    
    while (running) {
        const command = await question('\n> ');
        const [cmd, ...args] = command.trim().split(' ');

        try {
            switch (cmd.toLowerCase()) {
                case 'teams':
                    await listTeams();
                    break;
                    
                case 'spaces':
                    const teamId = args[0] || await question('Team ID: ');
                    await listSpaces(teamId);
                    break;
                    
                case 'folders':
                    const spaceId = args[0] || await question('Space ID: ');
                    await listFolders(spaceId);
                    break;
                    
                case 'lists':
                    const folderId = args[0] || await question('Folder ID: ');
                    await listLists(folderId);
                    break;
                    
                case 'tasks':
                    const listId = args[0] || await question('List ID: ');
                    await listTasks(listId);
                    break;
                    
                case 'task':
                    const taskId = args[0] || await question('Task ID: ');
                    await getTask(taskId);
                    break;
                    
                case 'create':
                    const createListId = args[0] || await question('List ID: ');
                    const taskName = await question('Task name: ');
                    const taskDesc = await question('Description (optional): ');
                    
                    const taskData = { name: taskName };
                    if (taskDesc) taskData.description = taskDesc;
                    
                    await createTask(createListId, taskData);
                    break;
                    
                case 'update':
                    const updateTaskId = args[0] || await question('Task ID: ');
                    const updateName = await question('New name (leave empty to skip): ');
                    const updateStatus = await question('New status (leave empty to skip): ');
                    
                    const updates = {};
                    if (updateName) updates.name = updateName;
                    if (updateStatus) updates.status = updateStatus;
                    
                    if (Object.keys(updates).length > 0) {
                        await updateTask(updateTaskId, updates);
                    } else {
                        console.log('No updates provided');
                    }
                    break;
                    
                case 'delete':
                    const deleteTaskId = args[0] || await question('Task ID: ');
                    const confirm = await question('Are you sure? (yes/no): ');
                    if (confirm.toLowerCase() === 'yes') {
                        await deleteTask(deleteTaskId);
                    } else {
                        console.log('Deletion cancelled');
                    }
                    break;
                    
                case 'exit':
                case 'quit':
                    running = false;
                    console.log('👋 Goodbye!');
                    break;
                    
                case 'help':
                    console.log('\nAvailable commands:');
                    console.log('  teams, spaces, folders, lists, tasks, task');
                    console.log('  create, update, delete, exit');
                    break;
                    
                default:
                    if (cmd) {
                        console.log(`❌ Unknown command: ${cmd}`);
                        console.log('Type "help" for available commands');
                    }
            }
        } catch (error) {
            console.error('❌ Error:', error.message);
            logger.error('Command error', { command: cmd, error: error.message });
        }
    }

    rl.close();
}

/**
 * Main CLI entry point
 */
async function main() {
    const args = process.argv.slice(2);
    
    if (args.length === 0) {
        // No arguments - enter interactive mode
        await interactiveMode();
        return;
    }

    const [command, ...params] = args;

    try {
        switch (command.toLowerCase()) {
            case 'teams':
                await listTeams();
                break;
                
            case 'members':
                if (!params[0]) {
                    console.error('❌ Error: Team ID required');
                    process.exit(1);
                }
                await listMembers(params[0]);
                break;
                
            case 'spaces':
                if (!params[0]) {
                    console.error('❌ Error: Team ID required');
                    process.exit(1);
                }
                await listSpaces(params[0]);
                break;
                
            case 'folders':
                if (!params[0]) {
                    console.error('❌ Error: Space ID required');
                    process.exit(1);
                }
                await listFolders(params[0]);
                break;
                
            case 'lists':
                if (!params[0]) {
                    console.error('❌ Error: Folder ID required');
                    process.exit(1);
                }
                await listLists(params[0]);
                break;
                
            case 'tasks':
                if (!params[0]) {
                    console.error('❌ Error: List ID required');
                    process.exit(1);
                }
                await listTasks(params[0]);
                break;
                
            case 'task':
                if (!params[0]) {
                    console.error('❌ Error: Task ID required');
                    process.exit(1);
                }
                await getTask(params[0]);
                break;
                
            case 'create':
                if (!params[0]) {
                    console.error('❌ Error: List ID required');
                    process.exit(1);
                }
                if (!params[1]) {
                    console.error('❌ Error: Task name required');
                    process.exit(1);
                }
                const taskData = { name: params.slice(1).join(' ') };
                await createTask(params[0], taskData);
                break;
                
            case 'update':
                if (!params[0]) {
                    console.error('❌ Error: Task ID required');
                    process.exit(1);
                }
                // Parse update parameters (e.g., --name "New Name" --status "In Progress")
                const updates = {};
                for (let i = 1; i < params.length; i += 2) {
                    const key = params[i].replace(/^--/, '');
                    const value = params[i + 1];
                    if (value) updates[key] = value;
                }
                if (Object.keys(updates).length > 0) {
                    await updateTask(params[0], updates);
                } else {
                    console.error('❌ Error: No updates provided');
                    process.exit(1);
                }
                break;
                
            case 'delete':
                if (!params[0]) {
                    console.error('❌ Error: Task ID required');
                    process.exit(1);
                }
                await deleteTask(params[0]);
                break;
                
            case 'pending':
            case 'gtw':
            case 'work':
                await getPendingTasks();
                break;
                
            case 'comments':
                if (!params[0]) {
                    console.error('❌ Error: Task ID required');
                    process.exit(1);
                }
                await getComments(params[0]);
                break;
                
            case 'comment':
                if (!params[0]) {
                    console.error('❌ Error: Task ID required');
                    process.exit(1);
                }
                if (!params[1]) {
                    console.error('❌ Error: Comment text required');
                    process.exit(1);
                }
                await addComment(params[0], params.slice(1).join(' '));
                break;
                
            case 'help':
            case '--help':
            case '-h':
                console.log('\n🚀 ClickUp CLI');
                console.log('='.repeat(50));
                console.log('\nUsage:');
                console.log('  node clickup.cli.mjs [command] [options]');
                console.log('  node clickup.cli.mjs              (interactive mode)');
                console.log('\nDaylightStation Commands:');
                console.log('  pending                           List all pending tasks (ready/in progress)');
                console.log('  comments <task-id>                Get comments for a task');
                console.log('  comment <task-id> <text>          Add a comment to a task');
                console.log('\nGeneral Commands:');
                console.log('  teams                             List all teams');
                console.log('  members <team-id>                 List team members');
                console.log('  spaces <team-id>                  List spaces in a team');
                console.log('  folders <space-id>                List folders in a space');
                console.log('  lists <folder-id>                 List lists in a folder');
                console.log('  tasks <list-id>                   List tasks in a list');
                console.log('  task <task-id>                    Get task details');
                console.log('  create <list-id> <name>           Create a new task');
                console.log('  update <task-id> --key value      Update a task');
                console.log('  delete <task-id>                  Delete a task');
                console.log('  help                              Show this help message');
                console.log('\nExamples:');
                console.log('  node clickup.cli.mjs pending');
                console.log('  node clickup.cli.mjs task 86czwmw4q');
                console.log('  node clickup.cli.mjs comments 86czwmw4q');
                console.log('  node clickup.cli.mjs comment 86czwmw4q "PRD ready for review"');
                console.log('  node clickup.cli.mjs update 86czwmw4q --status "in progress"');
                console.log('='.repeat(50));
                break;
                
            default:
                console.error(`❌ Unknown command: ${command}`);
                console.error('Run "node clickup.cli.mjs help" for usage information');
                process.exit(1);
        }
    } catch (error) {
        logger.error('CLI error', { command, error: error.message });
        console.error('❌ Error:', error.message);
        process.exit(1);
    }
}

// Run the CLI
main().catch(error => {
    logger.error('Unhandled error', { error: error.message, stack: error.stack });
    console.error('❌ Unhandled error:', error.message);
    process.exit(1);
});
