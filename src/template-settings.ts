export abstract class TemplateSettingsBase {
    protected nameToIdentifier(name : string):string {
        return name.toLowerCase().replace(/\W+/, '_');
    }

    private startsWithNumber(text : string):boolean {
        return text.charAt(0).match(/[0-9]/) !== null;
    }
    
    protected nameToClassIdentifier(name : string):string {
        let parts = name.split(/\W+/);
        let result = '';
        let allowNumber = false;
        for (let part of parts) {
            if (part.length > 0 && (allowNumber || !this.startsWithNumber(part))) {
                result += part.charAt(0).toUpperCase() + part.slice(1);
                allowNumber = true;
            }
        }
        return result;
    }

    abstract getIdName():string;
    abstract getClassName():string;
}

export class PanelSettings extends TemplateSettingsBase {
    name : string;
    spaceType : string;
    regionType : string;
    group : string;

    constructor(name : string, spaceType : string, regionType : string, group : string) {
        super();
        this.name = name;
        this.spaceType = spaceType;
        this.regionType = regionType;
        this.group = group;
    }

    getIdName() {
        return `${this.group}_PT_${this.nameToIdentifier(this.name)}`;
    }

    getClassName() {
        return this.nameToClassIdentifier(this.name) + 'Panel';
    }
}

export class OperatorSettings extends TemplateSettingsBase {
    name : string;
    group : string;

    constructor(name : string, group : string) {
        super()
        this.name = name;
        this.group = group;
    }

    getIdName() {
        return `${this.group}.${this.nameToIdentifier(this.name)}`;
    }

    getClassName() {
        return this.nameToClassIdentifier(this.name) + 'Operator';
    }
}