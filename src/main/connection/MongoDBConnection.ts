import { Db, MongoClient } from 'mongodb';
import { DatabaseConnection, IDatabaseConnectionRead, IDatabaseCount, IDatabaseField, IDatabaseQueryFilterExpression } from ".."

export class MongoDBConnection extends DatabaseConnection {
    private mcon?: MongoClient;
    private databaseName: string;
    private database?: Db;
    private isConnecting: boolean;

    constructor({ connectionURI, database }: { connectionURI: string, database: string }) {
        super();
        this.databaseName = database;
        this.isConnecting = false;
        this.mcon = new MongoClient(connectionURI);
    }

    public async connect(): Promise<void> {
        if (!this.mcon) throw new Error('Mongo client not created!');
        if (this.isConnected || this.isConnecting) return;
        this.isConnecting = true;
        await this.mcon.connect();
        this.database = this.mcon.db(this.databaseName);
        await this.database.command({ ping: 1 });
        this.isConnecting = false;
        this.isConnected = true;
        return;
    }
    public async disconnect(): Promise<void> {
        if (!this.isConnected) return;
        this.mcon?.close();
        this.isConnected = false;
        this.isConnecting = false;
    }
    public async create(database: string, keys: string[], fields: string[], values: any[]): Promise<Record<string, any>> {
        if (!this.isConnected) throw new Error('Database isn\'t connected');
        const table = this.database!.collection(database);
        const dataObj = {};
        keys.forEach((key, index) => {
            Object.assign(dataObj, { [key]: values[index] });
        });
        const result =  await table.insertOne(dataObj);
        if (!result.acknowledged) throw new Error('Database operation error');
        const id = result.insertedId;
        const addedData = await table.findOne({ _id: id }, {
            projection: fields.map((item) => { return { [item]: 1 }; })
        });
        return {...addedData};
    }
    public read({ keys, database, filter, limit, orderBy }: IDatabaseConnectionRead): Promise<Record<string, any>[]> {
        throw new Error("Method not implemented.");
    }
    public upsert(database: string, keys: string[], fields: string[], values: any[], updateFields: string[]): Promise<Record<string, any>> {
        throw new Error("Method not implemented.");
    }
    public update(database: string, fields: string[], newData: any[], filter: IDatabaseQueryFilterExpression): Promise<Record<string, any>> {
        throw new Error("Method not implemented.");
    }
    public delete(database: string, filter: IDatabaseQueryFilterExpression): Promise<number> {
        throw new Error("Method not implemented.");
    }
    public createTable(tableName: string, fields: Record<string, IDatabaseField>): Promise<void> {
        throw new Error("Method not implemented.");
    }
    public createOrUpdateTable(tableName: string, fields: Record<string, IDatabaseField>): Promise<void> {
        throw new Error("Method not implemented.");
    }
    public count(database: string, { fields, filter }: { fields: IDatabaseCount[]; filter?: IDatabaseQueryFilterExpression; }): Promise<Record<string, number>> {
        throw new Error("Method not implemented.");
    }

}