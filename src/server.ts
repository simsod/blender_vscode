import { RestClient } from 'typed-rest-client';
import { Server, IncomingMessage, ServerResponse, createServer } from 'http';
import { OperatorSettings, PanelSettings } from './template-settings';
import { EventEmitter } from 'events';


export class BlenderServer extends EventEmitter {
    private _blenderPort: Number | undefined;
    private _client: RestClient | null;
    private _addonServer: Server;

    constructor(serverPort: Number) {
        super();
        this._client = null;
        this._addonServer = createServer((request: IncomingMessage, response: ServerResponse) => this.handleRequest(request, response));
        this._addonServer.listen(serverPort);
    }

    public get port(): Number | undefined {
        return this._blenderPort;
    }

    public get endpoint(): string {
        if (!this._blenderPort)
            throw Error("Blender port has not yet been initialized");

        return `http://localhost:${this._blenderPort}`;
    }

    private get client(): RestClient {
        if (this._client)
            return this._client;
        else if (this._blenderPort) {
            this._client = new RestClient('blender-vscode', this.endpoint);
            return this._client;
        }
        throw Error("Blender REST client has not yet been initialized");
    }

    public async updateAddon(): Promise<{} | null> {
        var body = { type: 'update' };

        const response = await this.client.create('', body);
        if (response.statusCode != 200){
            throw Error("update addon returned with statuscode " + response.statusCode);
        }
        
        this.emit(Events.AddonUpdated);
        return response.result;
    }

    private handleRequest(request: IncomingMessage, response: ServerResponse) {
        if (request.method === 'POST') {
            let body = '';
            request.on('data', (chunk: any) => body += chunk.toString());
            request.on('end', () => {
                let res = JSON.parse(body);
                if (res.type === 'setup') {
                    this._blenderPort = res.blenderPort;
                    this.emit(Events.Debug, { debugPort: res.debugPort });
                    console.log("Emitted debug event with data: " + JSON.stringify(res));
                    response.end('OK');
                } else if (res.type === 'newOperator') {
                    let settings = new OperatorSettings(res.name, res.group);
                    this.emit(Events.InsertNewOperator, settings);
                    response.end('OK');
                } else if (res.type === 'newPanel') {
                    let settings = new PanelSettings(res.name, res.spaceType, res.regionType, res.group);
                    this.emit(Events.InsertNewPanel, settings);
                    response.end('OK');
                }
            });
        }
    }

    public dispose() {
        super.removeAllListeners();
        this._addonServer.close();
    }
}
export enum Events {
    Debug = "debug",
    Update = "update",
    InsertNewOperator = "insert-new-operator",
    InsertNewPanel = "insert-new-panel",
    AddonUpdated = 'addon-updated'
}