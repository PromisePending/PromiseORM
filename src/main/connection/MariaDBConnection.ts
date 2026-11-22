import { EDatabaseQueryFilterOperator,
  EDatabaseTypes, EMariaDBFieldTypes,
  IDatabaseConnectionRead,
  IDatabaseCount,
  IDatabaseField, IDatabaseQueryFilter,
  IDatabaseQueryFilterExpression,
  IMariaDBDescribeField,
  IMariaDBField,
} from '../interfaces';
import { DatabaseConnection } from './DatabaseConnection';
import mariaDB, { Pool, PoolConnection } from 'mariadb';
import { DatabaseException } from '../errors';

export class MariaDBConnection extends DatabaseConnection {
  private hostname: string;
  private username: string;
  private password: string;
  private database: string;
  private port: number;
  private dropUnknownColumns: boolean;
  private timezone: string;
  private version: string[];
  private explicitDefaultsForTimestamp: boolean = true;
  private tables: Map<string, Record<string, IDatabaseField>> = new Map();

  private pool?: Pool;
  private connecting?: Promise<void>;

  /**
   * @param timezone Timezone used to convert dates: 'local' (default) uses the Node.js timezone without changing the session one, 'auto' sets the session timezone to the Node.js one, '±HH:MM' forces a fixed offset
   */
  constructor({ hostname, port, username, password, database, dropUnknownColumns, timezone }: {
    hostname: string, port: number, username: string, password: string, database: string, dropUnknownColumns?: boolean, timezone?: string,
  }) {
    super();

    this.hostname = hostname;
    this.username = username;
    this.password = password;
    this.database = database;
    this.port = port;
    this.dropUnknownColumns = dropUnknownColumns ?? false;
    this.timezone = timezone ?? 'local';
    this.version = []; // [10, 2, 14, MariaDB]
  }

  override async connect(): Promise<void> {
    if (this.isConnected) return;
    this.connecting ??= (async (): Promise<void> => {
      this.pool = mariaDB.createPool({
        host: this.hostname,
        user: this.username,
        password: this.password,
        port: this.port,
        database: this.database,
        connectionLimit: 10,
        allowPublicKeyRetrieval: true,
        bigIntAsNumber: true,
        decimalAsNumber: true,
        insertIdAsNumber: true,
        checkNumberRange: true,
        timezone: this.timezone,
      });
      try {
        const tmpConn = await this.pool.getConnection();
        this.version = tmpConn.serverVersion().split(/\.|-/);
        const [{ value }] = await tmpConn.query('SELECT @@explicit_defaults_for_timestamp AS value');
        this.explicitDefaultsForTimestamp = Number(value) === 1;
        await tmpConn.release();
        this.isConnected = true;
      } catch (error) {
        await this.pool.end().catch(() => {});
        throw error;
      }
    })().finally(() => {
      this.connecting = undefined;
    });
    return this.connecting;
  }

  override async disconnect(): Promise<void> {
    if (this.connecting) await this.connecting.catch(() => {});
    if (!this.isConnected) return;
    await this.pool?.end();
    this.isConnected = false;
  }

  /**
   * @private
   */
  private filterBuilder(conn: PoolConnection, filter: IDatabaseQueryFilter | IDatabaseQueryFilterExpression): string {
    if (filter.hasOwnProperty('tableKey')) {
      const { tableKey, operator, value } = filter as IDatabaseQueryFilter;
      if (value === null) return `${conn.escapeId(tableKey)} ${operator === EDatabaseQueryFilterOperator.NOT_EQUALS ? 'IS NOT' : 'IS'} NULL`;
      if (operator === EDatabaseQueryFilterOperator.IN) return `${conn.escapeId(tableKey)} IN (${(value as any[]).map((item) => conn.escape(item)).join(', ')})`;
      if (operator === EDatabaseQueryFilterOperator.BETWEEN) return `${conn.escapeId(tableKey)} BETWEEN ${conn.escape((value as any[])[0])} AND ${conn.escape((value as any[])[1])}`;
      return `${conn.escapeId(tableKey)} ${operator} ${conn.escape(value)}`;
    }
    return `(${(filter as IDatabaseQueryFilterExpression).filters.map((filter) => this.filterBuilder(conn, filter)).join(` ${(filter as IDatabaseQueryFilterExpression).type} `)})`;
  }

  private hasFilters(filter?: IDatabaseQueryFilterExpression): filter is IDatabaseQueryFilterExpression {
    return !!filter && filter.filters.length > 0;
  }

  private equalsFilter(data: Record<string, any>, keys: string[] = Object.keys(data)): IDatabaseQueryFilterExpression {
    return { type: 'AND', filters: keys.map((key) => ({ tableKey: key, operator: EDatabaseQueryFilterOperator.EQUALS, value: data[key] })) };
  }

  private primaryKeys(database: string): string[] {
    const fields = this.tables.get(database) ?? {};
    return Object.keys(fields).filter((key) => fields[key].primaryKey);
  }

  private uniqueKeys(database: string): string[] {
    const fields = this.tables.get(database) ?? {};
    return Object.keys(fields).filter((key) => fields[key].type !== EDatabaseTypes.BOOLEAN && fields[key].unique && !fields[key].nullable);
  }

  private comparableKeys(database: string, keys: string[]): string[] {
    const fields = this.tables.get(database) ?? {};
    const comparable = keys.filter((key) => !fields[key] || (fields[key].type !== EDatabaseTypes.TIMESTAMP && fields[key].type !== EDatabaseTypes.DECIMAL));
    return comparable.length > 0 ? comparable : keys;
  }

  private identityKeys(database: string): string[] {
    const primaryKeys = this.primaryKeys(database);
    if (primaryKeys.length > 0) return primaryKeys;
    const uniqueKeys = this.uniqueKeys(database);
    if (uniqueKeys.length > 0) return [uniqueKeys[0]];
    return this.comparableKeys(database, Object.keys(this.tables.get(database) ?? {}));
  }

  private async getConnection(): Promise<PoolConnection> {
    if (!this.isConnected) throw new DatabaseException('Database is not connected!');
    return await this.pool!.getConnection();
  }

  private selectQuery(conn: PoolConnection, { keys, database, filter, limit, offset, orderBy }: IDatabaseConnectionRead): string {
    const operators: string[] = [];
    operators.push(typeof keys === 'string' ? '*' : keys.map(key => conn.escapeId(key)).join(', '));
    operators.push(`FROM ${conn.escapeId(database)}`);
    if (this.hasFilters(filter)) operators.push(`WHERE ${this.filterBuilder(conn, filter)}`);
    if (orderBy) {
      operators.push(`ORDER BY ${(Array.isArray(orderBy) ? orderBy : [orderBy]).map((item) => {
        const direction = String(item.direction).toUpperCase();
        if (direction !== 'ASC' && direction !== 'DESC') throw new DatabaseException(`Invalid order direction '${item.direction}', it must be ASC or DESC!`);
        return `${conn.escapeId(item.field)} ${direction}`;
      }).join(', ')}`);
    }
    if (limit != null) {
      if (!Number.isInteger(limit) || limit < 0) throw new DatabaseException('Limit must be a non negative integer (0 means no limit)');
      if (limit > 0) operators.push(`LIMIT ${limit}`);
    }
    if (offset != null) {
      if (!Number.isInteger(offset) || offset < 0) throw new DatabaseException('Offset must be a non negative integer');
      if (!limit) operators.push('LIMIT 18446744073709551615');
      operators.push(`OFFSET ${offset}`);
    }
    return `SELECT ${operators.join(' ')}`;
  }

  private async processInstruction(
    conn: PoolConnection, database: string, keys: string[], fields: string[], values: any[], instructions: string[], ignoreDuplicates: boolean = false,
  ): Promise<Record<string, any>[]> {
    if (Number(this.version[0]) > 10 || (Number(this.version[0]) === 10 && Number(this.version[1]) >= 5)) {
      instructions.push('RETURNING');
      instructions.push(fields.map((field) => conn.escapeId(field)).join(', '));
      return await conn.query(instructions.join(' '));
    }
    const { insertId, affectedRows } = await conn.query(instructions.join(' '));
    if (ignoreDuplicates && affectedRows === 0) return [];
    const inserted: Record<string, any> = {};
    keys.forEach((key, index) => inserted[key] = values[index]);
    const primaryKeys = this.primaryKeys(database);
    const missingPrimaryKeys = primaryKeys.filter((key) => !keys.includes(key));
    let identityKeys: string[];
    if (primaryKeys.length > 0 && (missingPrimaryKeys.length === 0 || (missingPrimaryKeys.length === 1 && insertId))) {
      if (missingPrimaryKeys.length === 1) inserted[missingPrimaryKeys[0]] = insertId;
      identityKeys = primaryKeys;
    } else {
      const uniqueKey = this.uniqueKeys(database).find((key) => inserted[key] != null);
      identityKeys = uniqueKey ? [uniqueKey] : this.comparableKeys(database, keys);
    }
    return await conn.query(this.selectQuery(conn, { keys: '*', database, filter: this.equalsFilter(inserted, identityKeys), limit: 1 }));
  }

  /**
   * @private
   */
  override async create(database: string, keys: string[], fields: string[], values: any[]): Promise<Record<string, any>> {
    const conn = await this.getConnection();
    try {
      const keysField = keys.map((key) => conn.escapeId(key)).join(', ');
      const instructions = ['INSERT INTO'];
      instructions.push(conn.escapeId(database));
      instructions.push(`(${keysField})`);
      instructions.push('VALUES');
      instructions.push(`(${values.map((value) => conn.escape(value)).join(', ')})`);
      return (await this.processInstruction(conn, database, keys, fields, values, instructions))[0];
    } finally {
      await conn.release();
    }
  }

  /**
   * @private
   */
  override async read(params: IDatabaseConnectionRead): Promise<Record<string, any>[]> {
    const conn = await this.getConnection();
    try {
      return await conn.query<Record<string, any>[]>(this.selectQuery(conn, params));
    } finally {
      await conn.release();
    }
  }

  /**
   * @private
   */
  override async update(database: string, fields: string[], newData: any[], filter: IDatabaseQueryFilterExpression): Promise<Record<string, any>> {
    if (!this.hasFilters(filter)) throw new DatabaseException('Empty filter! Updating without a filter is not allowed.');
    const conn = await this.getConnection();
    try {
      const identityKeys = this.identityKeys(database);
      const current: Record<string, any> = (await conn.query(this.selectQuery(conn, {
        keys: identityKeys.length > 0 ? identityKeys : '*',
        database,
        filter,
        limit: 1,
      })))[0];
      const instructions = ['UPDATE'];
      instructions.push(conn.escapeId(database));
      instructions.push('SET');
      instructions.push(fields.map((field, index) => `${conn.escapeId(field)} = ${conn.escape(newData[index])}`).join(', '));
      instructions.push('WHERE');
      instructions.push(this.filterBuilder(conn, filter));
      await conn.query(instructions.join(' '));
      if (!current) return current;
      fields.forEach((field, index) => {
        if (field in current) current[field] = newData[index];
      });
      return (await conn.query(this.selectQuery(conn, { keys: '*', database, filter: this.equalsFilter(current), limit: 1 })))[0];
    } finally {
      await conn.release();
    }
  }

  /**
   * @private
   */
  override async upsert(database: string, keys: string[], fields: string[], values: any[], updateFields: string[]): Promise<Record<string, any> | []> {
    const conn = await this.getConnection();
    try {
      const keysField = keys.map((key) => conn.escapeId(key)).join(', ');
      const instructions = ['INSERT'];
      if (updateFields.length === 0) instructions.push('IGNORE');
      instructions.push('INTO');
      instructions.push(conn.escapeId(database));
      instructions.push(`(${keysField})`);
      instructions.push('VALUES');
      instructions.push(`(${values.map((value) => conn.escape(value)).join(', ')})`);
      if (updateFields.length > 0) {
        instructions.push('ON DUPLICATE KEY UPDATE');
        const fieldsSQL: string[] = [];
        updateFields.forEach((field) => {
          fieldsSQL.push(`${conn.escapeId(field)} = VALUES(${conn.escapeId(field)})`);
        });
        instructions.push(fieldsSQL.join(','));
      }
      const rows = await this.processInstruction(conn, database, keys, fields, values, instructions, updateFields.length === 0);
      return rows.length === 0 ? [] : rows[0];
    } finally {
      await conn.release();
    }
  }

  /**
   * @private
   */
  override async delete(database: string, filter?: IDatabaseQueryFilterExpression): Promise<number> {
    if (filter && !this.hasFilters(filter)) throw new DatabaseException('Empty filter! Deleting without a filter is not allowed.');
    const conn = await this.getConnection();
    try {
      const result = await conn.query(`DELETE FROM ${conn.escapeId(database)}${this.hasFilters(filter) ? ` WHERE ${this.filterBuilder(conn, filter)}` : ''}`);
      return result.affectedRows;
    } finally {
      await conn.release();
    }
  }

  /**
   * @private
   */
  override async count(database: string, { fields, filter }: { fields: IDatabaseCount[]; filter?: IDatabaseQueryFilterExpression; }): Promise<Record<string, number>> {
    const conn = await this.getConnection();
    try {
      const counts: string[] = [];
      fields.forEach((field) => counts.push(
        `COUNT(${field.distinct ? 'DISTINCT ' : ''}${field.key === '*' ? '*' : conn.escapeId(field.key)})${field.alias ? ` AS ${conn.escapeId(field.alias)}` : ''}`,
      ));
      const result = await conn.query(`SELECT ${counts.join(', ')} FROM ${conn.escapeId(database)}${this.hasFilters(filter) ? ` WHERE ${this.filterBuilder(conn, filter)}` : ''}`);
      return result[0];
    } finally {
      await conn.release();
    }
  }

  /**
   * @private
   */
  private convertTypes(field: IDatabaseField): IMariaDBField {
    if (!(field.type === EDatabaseTypes.BOOLEAN || field.type === EDatabaseTypes.TIMESTAMP) && !field.maxSize)
      throw new DatabaseException('Any field (other than boolean and timestamp) must have a maxSize!');
    const finalObject: IMariaDBField = {
      type: EMariaDBFieldTypes.string,
      attributes: '',
      typeSize: field.type === EDatabaseTypes.BOOLEAN ? 1 : field.maxSize,
      nullable: field.nullable,
      primaryKey: (field.primaryKey && (field.type === EDatabaseTypes.UINT || field.type === EDatabaseTypes.SINT)) ?? false,
      autoIncrement: field.autoIncrement ?? false,
      unique: (field.type === EDatabaseTypes.BOOLEAN ? false : field.unique) ?? false,
      default: field.default,
    };
    switch (field.type) {
      case EDatabaseTypes.DECIMAL:
        finalObject.type = EMariaDBFieldTypes.decimal;
        var amountOfDecimalPlaces = Math.max(this.decimalPlaces(field.maxSize!), this.decimalPlaces(field.minSize ?? 0));
        var amountOfDigits = Math.ceil(Math.log10(Math.floor(Math.max(Math.abs(field.maxSize!), Math.abs(field.minSize ?? 0))) + 1));
        finalObject.typeSize = [amountOfDigits + amountOfDecimalPlaces, amountOfDecimalPlaces];
        break;
      case EDatabaseTypes.TIMESTAMP:
        finalObject.type = EMariaDBFieldTypes.timestamp;
        if (!this.explicitDefaultsForTimestamp && !field.nullable && !field.primaryKey && field.default === undefined) finalObject.default = 'CURRENT_TIMESTAMP()';
        break;
      case EDatabaseTypes.STRING:
        finalObject.type = EMariaDBFieldTypes.string;
        break;
      case EDatabaseTypes.BOOLEAN:
        finalObject.type = EMariaDBFieldTypes.boolean;
        break;
      case EDatabaseTypes.SINT:
      case EDatabaseTypes.UINT:
        if (field.type === EDatabaseTypes.UINT) finalObject.attributes = 'UNSIGNED';
        finalObject.typeSize = Math.ceil(Math.log10(field.maxSize! + 1));
        var amountOfBits = Math.ceil(Math.log2(Math.max(field.maxSize!, 0) + 1));
        if (field.type === EDatabaseTypes.SINT) amountOfBits = Math.max(amountOfBits, Math.ceil(Math.log2(-Math.min(field.minSize ?? 0, 0)))) + 1;
        var amountOfBytes = Math.ceil(amountOfBits / 8);
        if (amountOfBytes === 0 || amountOfBytes === 1) finalObject.type = EMariaDBFieldTypes.tinyint;
        else if (amountOfBytes === 2) finalObject.type = EMariaDBFieldTypes.smallint;
        else if (amountOfBytes === 3) finalObject.type = EMariaDBFieldTypes.mediumint;
        else if (amountOfBytes === 4) finalObject.type = EMariaDBFieldTypes.int;
        else if (amountOfBytes >= 5 && amountOfBytes <= 8) finalObject.type = EMariaDBFieldTypes.bigint;
        else throw new DatabaseException('Invalid size for INT');
        break;
      default:
        throw new DatabaseException('Invalid field type!');
    }
    if (field.foreignKey) finalObject.foreignKey = { ...field.foreignKey, table: field.foreignKey.table.getName() };
    return finalObject;
  }

  private decimalPlaces(value: number): number {
    return (value % 1 !== 0) ? value.toString().split('.')[1].length : 0;
  }

  private isExpressionDefault(field: IMariaDBField): boolean {
    return field.type === EMariaDBFieldTypes.timestamp && typeof field.default === 'string' &&
      /^CURRENT_TIMESTAMP(\(\d?\))?( ON UPDATE CURRENT_TIMESTAMP(\(\d?\))?)?$/i.test(field.default);
  }

  private sqlType(field: IMariaDBField): string {
    let type: string = field.type;
    if (field.type !== EMariaDBFieldTypes.boolean && field.typeSize !== undefined) type += '(' + field.typeSize.toString() + ')';
    if (field.attributes) type += ' ' + field.attributes;
    return type;
  }

  private normalizeType(type: string): string {
    return type.toLowerCase().replace(/\s+/g, ' ').trim()
      .replace(/^boolean$/, 'tinyint(1)')
      .replace(/^(tinyint|smallint|mediumint|int|bigint)\(\d+\)/, '$1');
  }

  private normalizeExtra(extra: string): string {
    return extra.toLowerCase().replace('default_generated', '').replace(/\(\d*\)/g, '').replace(/\s+/g, ' ').trim();
  }

  private normalizeDefault(conn: PoolConnection, value: unknown): string | null {
    if (value == null) return null;
    if (typeof value === 'boolean') return value ? '1' : '0';
    const text = (value instanceof Date ? conn.escape(value) : String(value)).replace(/^'(.*)'$/, '$1');
    if (/^current_timestamp/i.test(text)) return text.toLowerCase().replace(/\(\d*\)/g, '');
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.0+$/.test(text)) return text.replace(/\.0+$/, '');
    return (text !== '' && !isNaN(Number(text))) ? String(Number(text)) : text;
  }

  private referenceOption(option?: string): string {
    return (!option || option === 'NO ACTION') ? 'RESTRICT' : option;
  }

  private foreignKeyNames(tableName: string, key: string): [string, string] {
    return [`${tableName}_${key}_fk`, `${tableName}_${key}_fk2`];
  }

  /**
   * @private
   */
  private createSQLField(conn: PoolConnection, name: string, data: IDatabaseField): string {
    const convertedTypes = this.convertTypes(data);
    let field = conn.escapeId(name) + ' ';
    field += this.sqlType(convertedTypes);
    if (!convertedTypes.nullable) field += ' NOT NULL';
    else if (!data.primaryKey) field += ' NULL';
    if (convertedTypes.default !== undefined)
      field += ' DEFAULT ' + (this.isExpressionDefault(convertedTypes) ? convertedTypes.default : conn.escape(convertedTypes.default));
    if (convertedTypes.autoIncrement) field += ' AUTO_INCREMENT';
    return field;
  }

  private foreignKeySQL(conn: PoolConnection, name: string, key: string, field: IDatabaseField): string {
    let query = `CONSTRAINT ${conn.escapeId(name)} FOREIGN KEY (${conn.escapeId(key)}) REFERENCES ${
      conn.escapeId(field.foreignKey!.table.getName())
    }(${conn.escapeId(field.foreignKey!.field)})`;
    if (field.foreignKey!.onDelete) query += ` ON DELETE ${field.foreignKey!.onDelete!}`;
    if (field.foreignKey!.onUpdate) query += ` ON UPDATE ${field.foreignKey!.onUpdate!}`;
    return query;
  }

  private createTableQuery(conn: PoolConnection, tableName: string, fields: Record<string, IDatabaseField>): string {
    const fieldsKeys = Object.keys(fields);
    const tableFields = fieldsKeys.map((fieldKey) => this.createSQLField(conn, fieldKey, fields[fieldKey]));
    const primaryKeys: string[] = [];
    const uniqueKeys: string[] = [];
    fieldsKeys.forEach((fieldKey) => {
      if (fields[fieldKey].primaryKey) primaryKeys.push(conn.escapeId(fieldKey));
      if (fields[fieldKey].type !== EDatabaseTypes.BOOLEAN && fields[fieldKey].unique) uniqueKeys.push(conn.escapeId(fieldKey));
    });

    // Add the constraints
    if (primaryKeys.length > 0) tableFields.push(`PRIMARY KEY (${primaryKeys.join(', ')})`);
    uniqueKeys.filter((key) => !primaryKeys.includes(key)).forEach((key) => tableFields.push(`UNIQUE INDEX ${key} (${key})`));
    fieldsKeys.filter(key => fields[key].foreignKey).forEach((key) => tableFields.push(this.foreignKeySQL(conn, this.foreignKeyNames(tableName, key)[0], key, fields[key])));

    return `CREATE TABLE ${conn.escapeId(tableName)} (${tableFields.join(', ')})`;
  }

  override async createTable(tableName: string, fields: Record<string, IDatabaseField>): Promise<void> {
    this.tables.set(tableName, fields);
    const conn = await this.getConnection();
    try {
      await conn.query(this.createTableQuery(conn, tableName, fields));
    } finally {
      await conn.release();
    }
  }

  override async createOrUpdateTable(tableName: string, fields: Record<string, IDatabaseField>): Promise<void> {
    this.tables.set(tableName, fields);
    const conn = await this.getConnection();
    try {
      const tableExists = await conn.query('SELECT 1 FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?', [tableName]);
      if (tableExists.length === 0) {
        await conn.query(this.createTableQuery(conn, tableName, fields));
        return;
      }

      const currentFields: IMariaDBDescribeField[] = await conn.query(`DESCRIBE ${conn.escapeId(tableName)}`);
      const fieldsKeys = Object.keys(fields);

      const tableData: { Table: string, 'Create Table': string } = (await conn.query(`SHOW CREATE TABLE ${conn.escapeId(tableName)}`))[0];

      const fieldsToAdd = fieldsKeys.filter((key) => !currentFields.find((field) => field.Field === key));
      const fieldsToRemove = currentFields.filter((field) => !fields[field.Field]);
      const fieldsToUpdate: string[] = [];

      const newPrimaryKeys = fieldsKeys.filter((key) => fields[key].primaryKey);
      const newUniqueKeys = fieldsKeys.filter((key) => fields[key].type !== EDatabaseTypes.BOOLEAN && fields[key].unique && !fields[key].primaryKey);
      const newForeignKeys = fieldsKeys.filter((key) => fields[key].foreignKey);

      const currentPrimaryKey = (tableData['Create Table'].match(/PRIMARY KEY \((.*?)\)/)?.[1] ?? '').split(',').map(key => key.replace(/`/g, '').trim()).filter(key => key.length > 0);
      const currentUniqueKeys = Array.from(tableData['Create Table'].matchAll(/UNIQUE KEY `(.*?)`/g)).map(match => match[1]).filter(key => !currentPrimaryKey.includes(key));
      const currentForeignKeys = Array.from(
        tableData['Create Table']
          .matchAll(/CONSTRAINT `(.*?)` FOREIGN KEY \(`(.*?)`\) REFERENCES `(.*?)` \(`(.*?)`\)( ON DELETE (RESTRICT|CASCADE|SET NULL|NO ACTION))?( ON UPDATE (RESTRICT|CASCADE|SET NULL|NO ACTION))?/g),
      ).map(match => ({ name: match[1], key: match[2], table: match[3], field: match[4], onDelete: match[6], onUpdate: match[8] }));

      // Find all fields that should be updated
      for (const field of currentFields) {
        if (!fields[field.Field]) continue;
        let changed = false;
        const newField = fields[field.Field];
        const newData = this.convertTypes(newField);
        const [newDefault, newOnUpdate] = this.isExpressionDefault(newData) ? (newData.default as string).split(/ ON UPDATE /i) : [newData.default];
        const newExtra = `${newData.autoIncrement ? 'auto_increment' : ''} ${newOnUpdate ? `on update ${newOnUpdate}` : ''}`;
        if (this.normalizeType(this.sqlType(newData)) !== this.normalizeType(field.Type)) changed = true;
        if ((newData.nullable && !newField.primaryKey) !== (field.Null === 'YES')) changed = true;
        if (this.normalizeExtra(newExtra) !== this.normalizeExtra(field.Extra)) changed = true;
        if (this.normalizeDefault(conn, newDefault) !== this.normalizeDefault(conn, field.Default)) changed = true;
        if (changed) fieldsToUpdate.push(field.Field);
      }

      const operations: string[] = [];
      if (currentPrimaryKey.join(',') !== newPrimaryKeys.join(',')) {
        if (currentPrimaryKey.length > 0) operations.push('DROP PRIMARY KEY');
        if (newPrimaryKeys.length > 0) operations.push(`ADD PRIMARY KEY (${newPrimaryKeys.map((key) => conn.escapeId(key)).join(', ')})`);
      }

      if (this.dropUnknownColumns) fieldsToRemove.forEach((field) => operations.push(`DROP ${conn.escapeId(field.Field)}`));
      else if (fieldsToRemove.length > 0)
        console.warn(`[PromiseORM] Table '${tableName}' has columns that don't exist on the model and will be kept: ${fieldsToRemove.map((field) => field.Field).join(', ')}`);
      fieldsToAdd.forEach((field) => operations.push(`ADD ${this.createSQLField(conn, field, fields[field])}`));
      fieldsToUpdate.forEach((field) => operations.push(`CHANGE ${conn.escapeId(field)} ${this.createSQLField(conn, field, fields[field])}`));

      const uniqueKeysToRemove = currentUniqueKeys.filter((key) => fields[key] && !newUniqueKeys.includes(key));
      const uniqueKeysToAdd = newUniqueKeys.filter((key) => !currentUniqueKeys.includes(key));

      uniqueKeysToRemove.forEach((field) => operations.push(`DROP INDEX ${conn.escapeId(field)}`));
      uniqueKeysToAdd.forEach((field) => operations.push(`ADD UNIQUE INDEX ${conn.escapeId(field)} (${conn.escapeId(field)})`));

      const foreignKeysToRemove = currentForeignKeys.filter((current) => {
        if (!fields[current.key]) return this.dropUnknownColumns;
        const foreignKey = fields[current.key].foreignKey;
        return !foreignKey ||
          !this.foreignKeyNames(tableName, current.key).includes(current.name) ||
          current.table !== foreignKey.table.getName() ||
          current.field !== foreignKey.field ||
          this.referenceOption(current.onDelete) !== this.referenceOption(foreignKey.onDelete) ||
          this.referenceOption(current.onUpdate) !== this.referenceOption(foreignKey.onUpdate);
      });
      const foreignKeysToAdd = newForeignKeys.filter((key) => !currentForeignKeys.find((current) => current.key === key && !foreignKeysToRemove.includes(current)));

      const usedNames = currentForeignKeys.map((current) => current.name);
      const reusedNames: string[] = [];
      foreignKeysToAdd.forEach((key) => {
        const names = this.foreignKeyNames(tableName, key);
        const name = names.find((candidate) => !usedNames.includes(candidate)) ?? names[0];
        if (usedNames.includes(name)) reusedNames.push(name);
        usedNames.push(name);
        operations.push(`ADD ${this.foreignKeySQL(conn, name, key, fields[key])}`);
      });
      if (reusedNames.length > 0)
        await conn.query(`ALTER TABLE ${conn.escapeId(tableName)} ${reusedNames.map((name) => `DROP FOREIGN KEY ${conn.escapeId(name)}`).join(', ')}`);
      operations.unshift(...foreignKeysToRemove.filter((current) => !reusedNames.includes(current.name)).map((current) => `DROP FOREIGN KEY ${conn.escapeId(current.name)}`));
      if (operations.length > 0) await conn.query(`ALTER TABLE ${conn.escapeId(tableName)} ${operations.join(', ')}`);
    } finally {
      await conn.release();
    }
  }
}
