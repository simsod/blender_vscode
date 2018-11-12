'use strict';

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as http from 'http';
import { exec, spawn } from 'child_process';
import * as utils from './utils';

import {
    OperatorSettings,
    PanelSettings
} from './template-settings';
import { BlenderServer, Events } from './server';

const request = require('request');

const PYTHON_FILES_DIR = path.join(path.dirname(__dirname), 'pythonFiles');
const TEMPLATE_FILES_DIR = path.join(PYTHON_FILES_DIR, 'templates');
const PIP_PATH = path.join(PYTHON_FILES_DIR, 'get-pip.py');
const CANCEL = 'CANCEL';

const SERVER_PORT = 6000;
let BLENDER_PORT: number | undefined = undefined;

let blenderServer: BlenderServer
export function activate(context: vscode.ExtensionContext) {
    let disposables = [
        vscode.commands.registerCommand('b3ddev.startBlender', COMMAND_startBlender),
        vscode.commands.registerCommand('b3ddev.newAddon', COMMAND_newAddon),
        vscode.commands.registerCommand('b3ddev.launchAddon', COMMAND_launchAddon),
        vscode.commands.registerCommand('b3ddev.updateAddon', COMMAND_updateAddon),
        vscode.workspace.onDidSaveTextDocument(HANDLER_updateOnSave),
    ];

    context.subscriptions.push(...disposables);
    blenderServer = new BlenderServer(SERVER_PORT);
    context.subscriptions.push(blenderServer);
}

export function deactivate() {
}


/* Commands
 *********************************************/

function COMMAND_startBlender() {
    tryGetBlenderPath(true, blenderPath => {
        exec(blenderPath);
    }, utils.showErrorIfNotCancel);
}

function COMMAND_newAddon() {
    let workspaceFolders = utils.getWorkspaceFolders();
    if (workspaceFolders.length === 0) {
        vscode.window.showOpenDialog({
            canSelectFiles: false,
            canSelectFolders: true,
            canSelectMany: false,
            openLabel: 'New Addon'
        }).then(value => {
            if (value === undefined) return;
            tryMakeAddonInFolder(value[0].fsPath, true);
        });
    } else if (workspaceFolders.length === 1) {
        tryMakeAddonInFolder(workspaceFolders[0].uri.fsPath);
    } else {
        vscode.window.showErrorMessage('Can\'t create a new addon in a workspace with multiple folders yet.');
    }

    function tryMakeAddonInFolder(folderPath: string, openWorkspace: boolean = false) {
        canAddonBeCreatedInFolder(folderPath, () => {
            askUser_SettingsForNewAddon((addonName, authorName) => {
                createNewAddon(folderPath, addonName, authorName, mainPath => {
                    if (openWorkspace) {
                        /* Extension will automatically be restarted after this. */
                        vscode.workspace.updateWorkspaceFolders(0, null, { uri: vscode.Uri.file(folderPath), name: addonName });
                    } else {
                        vscode.workspace.openTextDocument(mainPath).then(document => {
                            vscode.window.showTextDocument(document);
                        });
                    }
                });
            }, utils.showErrorIfNotCancel);
        }, utils.showErrorIfNotCancel);
    }
}

function COMMAND_launchAddon() {
    console.log("Subscribed to debug event");
    tryGetBlenderPath(true, blenderPath => {
        launch_Single_External(blenderPath, (<vscode.WorkspaceFolder[]>vscode.workspace.workspaceFolders)[0].uri.fsPath);
        blenderServer.on(Events.Debug, startPythonDebugging)
        blenderServer.on(Events.InsertNewOperator, (settings) => insertTemplate_SimpleOperator(settings, utils.showErrorIfNotCancel))
        blenderServer.on(Events.InsertNewPanel, (settings) => insertTemplate_Panel(settings, utils.showErrorIfNotCancel))
    }, utils.showErrorIfNotCancel);

}

function COMMAND_updateAddon(onSuccess: (() => void) | undefined = undefined) {
    vscode.workspace.saveAll(false);
    request.post(
        `http://localhost:${BLENDER_PORT}`,
        { json: { type: 'update' } },
        function (err: any, response: any, body: any) {
            if (err === null && onSuccess !== undefined) onSuccess();
        }
    );
}

/* Event Handlers
 ***************************************/

function HANDLER_updateOnSave(document: vscode.TextDocument) {
    if (utils.getConfiguration().get('updateOnSave')) {
        COMMAND_updateAddon(() => {
            vscode.window.showInformationMessage("Addon Updated");
        });
    }
}

function startPythonDebugging(config: any) {
    let configuration = {
        name: "Debug Python in Blender",
        request: "attach",
        type: "python",
        port: config.debugPort,
        host: "localhost"
    };
    vscode.debug.startDebugging(undefined, configuration);
}

function launch_Single_External(blenderPath: string, launchDirectory: string) {
    let pyLaunchPath = path.join(PYTHON_FILES_DIR, 'launch_external.py');
    utils.runExternalCommand(blenderPath, ['--python', pyLaunchPath], {
        ADDON_DEV_DIR: launchDirectory,
        DEBUGGER_PORT: SERVER_PORT,
        PIP_PATH: PIP_PATH,
    });
}

function tryGetBlenderPath(allowAskUser: boolean, onSuccess: (path: string) => void, onError: (reason: string) => void) {
    let config = utils.getConfiguration();
    let savedBlenderPath = config.get('blenderPath');

    if (savedBlenderPath !== undefined && savedBlenderPath !== "") {
        onSuccess(<string>savedBlenderPath);
    } else {
        if (allowAskUser) {
            askUser_BlenderPath(onSuccess, onError);
        } else {
            onError('Could not get path to Blender.');
        }
    }
}

function askUser_SettingsForNewAddon(onSuccess: (addonName: string, authorName: string) => void, onError: (reason: string) => void) {
    vscode.window.showInputBox({
        placeHolder: 'Addon Name (can be changed later)',
    }).then(addonName => {
        if (addonName === undefined) {
            onError(CANCEL);
        } else if (addonName === "") {
            onError('Can\'t create an addon without a name.');
            return;
        }

        vscode.window.showInputBox({ placeHolder: 'Your Name (can be changed later)' }).then(authorName => {
            if (authorName === undefined) {
                onError(CANCEL);
            } else if (authorName === "") {
                onError('Can\'t create an addon without an author name.');
            } else {
                onSuccess(<string>addonName, <string>authorName);
            }
        });
    });
}

function askUser_BlenderPath(onSuccess: (path: string) => void, onError: (reason: string) => void) {
    var dialogSettings = {
        canSelectFiles: true,
        canSelectFolders: false,
        canSelectMany: false,
        openLabel: 'Blender Executable'
    };

    vscode.window.showOpenDialog(dialogSettings).then(value => {
        if (value === undefined) {
            onError(CANCEL);
            return;
        }
        let filepath = value[0].fsPath;
        if (os.platform() === 'darwin') {
            filepath = `${filepath}/Contents/MacOS/blender`;
        }

        testIfPathIsBlender(filepath, is_valid => {
            if (is_valid) {
                utils.getConfiguration().update('blenderPath', filepath);
                onSuccess(filepath);
            } else {
                onError('Selected file is not a valid Blender executable.');
            }
        });
    });
}

function createNewAddon(folder: string, addonName: string, authorName: string, onSuccess: (mainPath: string) => void) {
    let initSourcePath = path.join(TEMPLATE_FILES_DIR, 'addon.py');
    let initTargetPath = path.join(folder, "__init__.py");
    utils.readTextFile(initSourcePath, text => {
        text = text.replace('ADDON_NAME', addonName);
        text = text.replace('AUTHOR_NAME', authorName);

        fs.writeFile(initTargetPath, text, (err: Error) => {
            if (err !== null) {
                vscode.window.showErrorMessage('Could not create the __init__.py file.');
                return;
            }
            onSuccess(initTargetPath);
        });
    }, utils.showErrorIfNotCancel);
}


/* Checking
 ***************************************/

function testIfPathIsBlender(filepath: string, callback: (isValid: boolean) => void) {
    let name: string = path.basename(filepath);

    if (name.toLowerCase().startsWith('blender')) {
        let testString = '###TEST_BLENDER###';
        let command = `${filepath} --python-expr "import sys;print('${testString}');sys.stdout.flush();sys.exit()"`;

        /* not starting in background because some addons might
         * crash Blender before the expression is executed */
        exec(command, {},
            (err: Error | null, stdout: string | Buffer, stderr: string | Buffer) => {
                let text = stdout.toString();
                callback(text.includes(testString));
            });
    } else {
        callback(false);
    }
}

function canAddonBeCreatedInFolder(folder: string, onSuccess: () => void, onError: (reason: string) => void) {
    fs.stat(folder, (err: Error, stat: any) => {
        if (err !== null) onError('Error when accesing the folder.');
        if (!stat.isDirectory()) onError('Not a directory.');

        fs.readdir(folder, (err, files: string[]) => {
            for (let name of files) {
                if (!name.startsWith('.')) {
                    onError('The folder already contains some files');
                    return;
                }
            }
            onSuccess();
        });
    });
}


function insertTemplate_SimpleOperator(settings: OperatorSettings, onError: (reason: string) => void) {
    let sourcePath = path.join(TEMPLATE_FILES_DIR, 'operator_simple.py');
    utils.readTextFile(sourcePath, text => {
        text = text.replace('LABEL', settings.name);
        text = text.replace('OPERATOR_CLASS', 'bpy.types.Operator');
        text = text.replace('IDNAME', settings.getIdName());
        text = text.replace('CLASS_NAME', settings.getClassName());
        insertTextBlock(text, onError);
    }, onError);
}


/* Panel Insertion
**************************************/

function insertTemplate_Panel(settings: PanelSettings, onError: (reason: string) => void) {
    let sourcePath = path.join(TEMPLATE_FILES_DIR, 'panel_simple.py');
    utils.readTextFile(sourcePath, text => {
        text = text.replace('LABEL', settings.name);
        text = text.replace('PANEL_CLASS', 'bpy.types.Panel');
        text = text.replace('SPACE_TYPE', settings.spaceType);
        text = text.replace('REGION_TYPE', settings.regionType);
        text = text.replace('CLASS_NAME', settings.getClassName());
        text = text.replace('IDNAME', settings.getIdName());
        insertTextBlock(text, onError);
    }, onError);
}

/* Text Block insertion
 **************************************/

function insertTextBlock(text: string, onError: (reason: string) => void) {
    let editor = vscode.window.activeTextEditor;

    if (editor === undefined) {
        onError('No active text editor.');
        return;
    }

    let endLine = findNextLineStartingInTheBeginning(editor.document, editor.selection.start.line + 1);
    let startLine = findLastLineContainingText(editor.document, endLine - 1);

    let position = new vscode.Position(startLine, editor.document.lineAt(startLine).text.length);
    let range = new vscode.Range(position, position);

    let textEdit = new vscode.TextEdit(range, '\n\n\n' + text);
    let workspaceEdit = new vscode.WorkspaceEdit();
    workspaceEdit.set(editor.document.uri, [textEdit]);
    vscode.workspace.applyEdit(workspaceEdit);
}

function findNextLineStartingInTheBeginning(document: vscode.TextDocument, start: number): number {
    for (let i = start; i < document.lineCount; i++) {
        let line = document.lineAt(i);
        if (line.text.length > 0 && line.firstNonWhitespaceCharacterIndex === 0) {
            return i;
        }
    }
    return document.lineCount;
}

function findLastLineContainingText(document: vscode.TextDocument, start: number): number {
    for (let i = start; i >= 0; i--) {
        let line = document.lineAt(i);
        if (!line.isEmptyOrWhitespace) {
            return i;
        }
    }
    return 0;
}