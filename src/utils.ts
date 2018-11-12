import * as fs from 'fs';
import * as vscode from 'vscode';
import { exec, spawn } from 'child_process';

export function readTextFile(path: string, onSuccess: (text: string) => void, onError: (reason: string) => void) {
    fs.readFile(path, 'utf8', (err: Error, data: any) => {
        if (err !== null) {
            onError(`Could not read the file: ${path}`);
            return;
        }

        onSuccess(data);
    });
}

export function runExternalCommand(command: string, args: string[], additionalEnv: any = {}) {
    let env = Object.assign({}, process.env, additionalEnv);
    let config = vscode.workspace.getConfiguration('terminal.external');
    if (process.platform === 'linux') {
        var linuxExec: string | undefined = config.get('linuxExec');
        if (!linuxExec) {
            throw Error("Unknown Linux exec");
        }
        spawn(linuxExec, ['-e', command, ...args], { env: env });
    } else if (process.platform === 'darwin') {
        console.log('Blender spawn output:');
        spawn(command, args, { env: env }).stdout.on('data', (data: any) => {
            console.log(data.toString());
        });


    } else if (process.platform === 'win32') {
        let fullCommand = 'start "" "' + command.replace('"', '//"') + '" ';
        for (let arg of args) {
            fullCommand += ' "' + arg.replace('"', '//"') + '" ';
        }

        exec(fullCommand, { env: env });
    }
}

export function showErrorIfNotCancel(message: string) {
    if (message !== 'CANCEL') {
        vscode.window.showErrorMessage(message);
    }
}

export function getWorkspaceFolders() {
    let folders = vscode.workspace.workspaceFolders;
    if (folders === undefined) return [];
    else return folders;
}

export function getConfiguration() {
     return vscode.workspace.getConfiguration('b3ddev');
 }