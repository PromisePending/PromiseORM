import { EDatabaseQueryFilterOperator, EDatabaseTypes, IDatabaseCount, IDatabaseField, IDatabaseOrderBy, IDatabaseQueryFilter, IDatabaseQueryFilterExpression } from '../interfaces';
import { DatabaseConnection } from '../connection';
import { DatabaseException } from '../errors';

/**
 * The BaseModel class is a class that represents a model in the database
 * @class
 */
export class BaseModel {
  protected connection?: DatabaseConnection;
  protected fields: Record<string, IDatabaseField> = {};
  protected nonNullableFields: string[] = [];
  protected name?: string;
  private isReady = false;

  /**
   * Create a new instance of the BaseModel
   * @param fields The fields of the model
   * @throws [{@link DatabaseException}]
   * @constructor
   */
  constructor(fields: Record<string, IDatabaseField>) {
    this.fields = fields;
    this.nonNullableFields = Object.keys(fields).filter((fieldKey) => !fields[fieldKey].nullable && !fields[fieldKey].autoIncrement && fields[fieldKey].default === undefined);

    Object.keys(fields).forEach((fieldKey) => {
      if (fields[fieldKey].foreignKey) {
        if (fields[fieldKey].foreignKey!.table === this) throw new DatabaseException(`${fieldKey} foreign key's table references the model itself (Circular Model dependence).`);
        const field = fields[fieldKey].foreignKey!.table.fields[fields[fieldKey].foreignKey!.field];
        if (!field)
          throw new DatabaseException(`Field ${fieldKey} has a foreign key with a field that doesn't exists on the table.`);
        if (field.type !== fields[fieldKey].type)
          throw new DatabaseException(`Foreign key field ${fieldKey} has a different type than the one referenced.`);
        if ((field.type !== EDatabaseTypes.BOOLEAN && field.maxSize) !== (fields[fieldKey].type !== EDatabaseTypes.BOOLEAN && fields[fieldKey].maxSize))
          throw new DatabaseException(`Foreign key field ${fieldKey} has a different maxSize than the one referenced.`);
        if ((field.type !== EDatabaseTypes.BOOLEAN && field.minSize) !== (fields[fieldKey].type !== EDatabaseTypes.BOOLEAN && fields[fieldKey].minSize))
          throw new DatabaseException(`Foreign key field ${fieldKey} has a different minSize than the one referenced.`);
      }
    });
  }

  /**
   * Register the model in the database
   * @param tableName The name of the table
   * @param connection The connection to the database
   * @throws [{@link DatabaseException}]
   */
  public async register(tableName: string, connection: DatabaseConnection): Promise<void> {
    this.name = tableName;
    this.connection = connection;

    await connection.createOrUpdateTable(this.name, this.fields);
    this.isReady = true;
  }

  /**
   * @private
   * @throws [{@link DatabaseException}]
   */
  private checkIsReady(): void {
    if (!this.isReady) throw new DatabaseException('Attempted to use model before registering on DataBaseManager!');
  }

  /**
   * Get the name of the model
   * @returns The name of the model
   * @throws [{@link DatabaseException}]
   */
  public getName(): string {
    this.checkIsReady();
    return this.name!;
  }

  /**
   * @private
   * @throws [{@link DatabaseException}]
   */
  private fieldsCheck(fields: string[]): void {
    if (fields.length === 0) throw new DatabaseException(`No field has been provided`);
    fields.forEach((field) => {
      if (!this.fields[field]) throw new DatabaseException(`Field ${field} doesn't exists in ${this.name} table!`);
    });
  }

  /**
   * @private
   * @throws [{@link DatabaseException}]
   */
  private fieldValueCheck(key: string, value: any, checkSize: boolean = true): void {
    if (this.fields[key].type === EDatabaseTypes.SINT || this.fields[key].type === EDatabaseTypes.UINT) {
      if (typeof value !== 'number') throw new DatabaseException(`Field ${key} has to be a number!`);
      if (Math.floor(value) !== value) throw new DatabaseException(`Field ${key} has to be an integer!`);
      if (this.fields[key].type === EDatabaseTypes.UINT && (value < 0)) throw new DatabaseException(`Field ${key} cannot be negative as is unsigned!`);
      if (this.fields[key].minSize && value < this.fields[key].minSize!) throw new DatabaseException(`Field ${key} has a minimum size of ${this.fields[key].minSize}!`);
      if (this.fields[key].maxSize && value > this.fields[key].maxSize!) throw new DatabaseException(`Field ${key} has a maximum size of ${this.fields[key].maxSize}!`);
    }
    if (this.fields[key].type === EDatabaseTypes.BOOLEAN && typeof value !== 'boolean') throw new DatabaseException(`Field ${key} has to be a boolean!`);
    if (this.fields[key].type === EDatabaseTypes.STRING) {
      if (typeof value !== 'string') throw new DatabaseException(`Field ${key} has to be a string!`);
      if (checkSize && this.fields[key].minSize && [...value].length < this.fields[key].minSize!) throw new DatabaseException(`Field ${key} has a minimum length of ${this.fields[key].minSize}!`);
      if (checkSize && this.fields[key].maxSize && [...value].length > this.fields[key].maxSize!) throw new DatabaseException(`Field ${key} has a maximum length of ${this.fields[key].maxSize}!`);
    }
    if (this.fields[key].type === EDatabaseTypes.DECIMAL) {
      if (typeof value !== 'number') throw new DatabaseException(`Field ${key} has to be a number!`);
      if (this.fields[key].minSize && value < this.fields[key].minSize!) throw new DatabaseException(`Field ${key} has a minimum size of ${this.fields[key].minSize}!`);
      if (this.fields[key].maxSize && value > this.fields[key].maxSize!) throw new DatabaseException(`Field ${key} has a maximum size of ${this.fields[key].maxSize}!`);
    }
  }

  private validFieldValueCheck(data: Record<string, any>): void {
    const keys = Object.keys(data);
    if (keys.length > 0) this.fieldsCheck(keys);
    const nonNullCheck = keys.filter((key) => this.nonNullableFields.includes(key) && data[key] == null);
    if (nonNullCheck.length > 0) throw new DatabaseException(`A null param was provided to a non-null field! Null was provided to the following non-null fields: ${nonNullCheck.join(', ')}`);
    keys.filter((key) => data[key] != null).forEach((key) => this.fieldValueCheck(key, data[key]));
  }

  /**
   * @private
   * @throws [{@link DatabaseException}]
   */
  private validFieldsCheck(data: Record<string, any>): void {
    this.validFieldValueCheck(data);
    const missingFields = this.nonNullableFields.filter((key) => data[key] == null);
    if (missingFields.length > 0) throw new DatabaseException(`A non nullable field has not been provided! ${missingFields.join(', ')}`);
  }

  /**
   * @private
   */
  private usesDefault(data: Record<string, any>, field: string): boolean {
    return this.fields[field].default !== undefined && (data[field] === undefined || (data[field] === null && !this.fields[field].nullable));
  }

  /**
   * @private
   */
  private insertKeys(data: Record<string, any>): string[] {
    return Object.keys(this.fields).filter((field) => !this.fields[field].autoIncrement &&
      !(this.usesDefault(data, field) && this.fields[field].type === EDatabaseTypes.TIMESTAMP && typeof this.fields[field].default === 'string'));
  }

  /**
   * @private
   */
  private insertValues(data: Record<string, any>, keys: string[]): any[] {
    return keys.map((fieldKey) => this.usesDefault(data, fieldKey) ? this.fields[fieldKey].default : data[fieldKey] ?? null);
  }

  /**
   * @private
   */
  private equalsFilter(query: Record<string, any>): IDatabaseQueryFilterExpression {
    return {
      type: 'AND',
      filters: Object.keys(query).map((fieldKey) => ({
        tableKey: fieldKey,
        operator: EDatabaseQueryFilterOperator.EQUALS,
        value: query[fieldKey],
      })),
    };
  }

  /**
   * @private
   */
  private isEmptyFilter(filter?: IDatabaseQueryFilterExpression): boolean {
    return !filter || !filter.filters || filter.filters.length === 0;
  }

  /**
   * @private
   * @throws [{@link DatabaseException}]
   */
  private queryCheck(query: Record<string, any>): void {
    const keys = Object.keys(query);
    if (keys.length === 0) return;
    this.fieldsCheck(keys);
    keys.forEach((key) => {
      if (query[key] === undefined) throw new DatabaseException(`Field ${key} has an undefined value!`);
      if (typeof query[key] === 'object' && query[key] !== null && !(query[key] instanceof Date)) throw new DatabaseException(`Field ${key} has an invalid value!`);
    });
  }

  /**
   * @private
   * @throws [{@link DatabaseException}]
   */
  private orderByCheck(orderBy?: IDatabaseOrderBy | IDatabaseOrderBy[]): void {
    if (!orderBy) return;
    const orders = Array.isArray(orderBy) ? orderBy : [orderBy];
    this.fieldsCheck(orders.map((order) => order.field));
    orders.forEach((order) => {
      if (!['ASC', 'DESC'].includes(String(order.direction).toUpperCase())) throw new DatabaseException(`Invalid order direction '${order.direction}', it must be ASC or DESC!`);
    });
  }

  /**
   * @private
   * @throws [{@link DatabaseException}]
   */
  private filterCheck(filter?: IDatabaseQueryFilterExpression): void {
    if (!filter) return;
    if (filter.type !== 'AND' && filter.type !== 'OR') throw new DatabaseException('Filter type must be AND or OR!');
    if (!filter.filters) throw new DatabaseException('Filter must have filters!');
    filter.filters.forEach((filterElement: IDatabaseQueryFilterExpression | IDatabaseQueryFilter) => {
      if ((filterElement as IDatabaseQueryFilterExpression).type) {
        if ((filterElement as IDatabaseQueryFilterExpression).filters?.length === 0) throw new DatabaseException('Nested filter expressions must have at least one filter!');
        this.filterCheck(filterElement as IDatabaseQueryFilterExpression);
      } else {
        if (
          (filterElement as IDatabaseQueryFilter).operator == null ||
          (filterElement as IDatabaseQueryFilter).tableKey == null ||
          (filterElement as IDatabaseQueryFilter).value === undefined
        )
          throw new DatabaseException('Filter must have operator, tableKey and value!');
        if (
          [
            EDatabaseQueryFilterOperator.EQUALS,
            EDatabaseQueryFilterOperator.GREATER_THAN,
            EDatabaseQueryFilterOperator.GREATER_THAN_OR_EQUALS,
            EDatabaseQueryFilterOperator.LESS_THAN,
            EDatabaseQueryFilterOperator.LESS_THAN_OR_EQUALS,
            EDatabaseQueryFilterOperator.NOT_EQUALS,
            EDatabaseQueryFilterOperator.LIKE,
            EDatabaseQueryFilterOperator.IN,
            EDatabaseQueryFilterOperator.BETWEEN,
          ].indexOf((filterElement as IDatabaseQueryFilter).operator) === -1) throw new DatabaseException('Invalid operator!');
        const { tableKey, operator, value } = filterElement as IDatabaseQueryFilter;
        this.fieldsCheck([tableKey]);
        if (value === null) {
          if (operator !== EDatabaseQueryFilterOperator.EQUALS && operator !== EDatabaseQueryFilterOperator.NOT_EQUALS)
            throw new DatabaseException(`Operator ${operator} cannot be used with a null value!`);
        } else if (operator === EDatabaseQueryFilterOperator.IN || operator === EDatabaseQueryFilterOperator.BETWEEN) {
          if (!Array.isArray(value) || value.length === 0) throw new DatabaseException(`Operator ${operator} requires a non empty array as value!`);
          if (operator === EDatabaseQueryFilterOperator.BETWEEN && value.length !== 2) throw new DatabaseException('Operator BETWEEN requires exactly 2 values!');
          (value as any[]).forEach((item) => this.fieldValueCheck(tableKey, item));
        } else {
          if (Array.isArray(value)) throw new DatabaseException(`Operator ${operator} doesn't accept an array as value!`);
          this.fieldValueCheck(tableKey, value, operator !== EDatabaseQueryFilterOperator.LIKE);
        }
      }
    });
  }

  /**
   * Find data in the model
   * @param query The query to be used to find the data
   * @param limit amount of rows to be returned
   * @param offset amount of rows to be skipped
   * @returns The data found
   * @throws [{@link DatabaseException}]
   */
  public async find(params?: { query?: Record<string, any>, limit?: number, offset?: number, orderBy?: IDatabaseOrderBy }): Promise<Record<string, unknown>[]> {
    const { query, limit, offset, orderBy } = params || {};
    this.checkIsReady();
    if (query) this.queryCheck(query);
    this.orderByCheck(orderBy);
    return this.connection!.read({ keys: '*', database: this.name!, filter: query ? this.equalsFilter(query) : undefined, limit, offset, orderBy });
  }

  /**
   * Find one data in the model
   * @param query The query to be used to find the data
   * @returns The data found
   * @throws [{@link DatabaseException}]
   */
  public async findOne(query?: Record<string, any>): Promise<Record<string, unknown> | undefined> {
    return Promise.resolve((await this.find({ query, limit: 1 }))[0]);
  }

  /**
   * Find data in the model by ID
   * @param id The ID value to be used to find
   * @param fieldName The field name to be used as id
   * @returns The data found
   * @throws [{@link DatabaseException}]
   */
  public async findByID(id: string | number, fieldName?: string): Promise<Record<string, unknown> | undefined> {
    return this.findOne({ [fieldName ?? 'id']: id });
  }

  /**
   * Select data in the model
   * @param fields list of filed keys to be selected
   * @param filter WHERE clause of the select query
   * @param limit amount of rows to be selected
   * @param offset amount of rows to be skipped
   * @returns The data found
   * @throws [{@link DatabaseException}]
   */
  public async select(params: { fields: string[], filter?: IDatabaseQueryFilterExpression, limit?: number, offset?: number, orderBy?: IDatabaseOrderBy },
  ): Promise<Record<string, unknown>[]> {
    this.checkIsReady();
    if (!params) throw new DatabaseException('Missing params for \'select\' method call, if you want to retrieve all data on this table call \'find\' instead.');
    const { fields, filter, limit, offset, orderBy } = params;
    this.fieldsCheck(fields);
    this.filterCheck(filter);
    this.orderByCheck(orderBy);
    return this.connection!.read({ keys: fields, database: this.name!, filter, limit, offset, orderBy });
  }

  /**
   * Select one data in the model
   * @param fields list of filed keys to be selected
   * @param filter WHERE clause of the select query
   * @returns The data found
   * @throws [{@link DatabaseException}]
   */
  public async selectOne(fields: string[], filter?: IDatabaseQueryFilterExpression): Promise<Record<string, unknown> | undefined> {
    return (await this.select({ fields, filter, limit: 1 }))[0];
  }

  /**
   * Create data in the model
   * @param data The data to be created
   * @throws [{@link DatabaseException}]
   */
  public async create(data: Record<string, any>): Promise<Record<string, unknown>> {
    this.checkIsReady();
    this.validFieldsCheck(data);
    const keys = this.insertKeys(data);
    return this.connection!.create(this.name!, keys, Object.keys(this.fields), this.insertValues(data, keys));
  }

  /**
   * Update data in the model
   * @param find The query to be used to find the data
   * @param update The data to be updated
   * @throws [{@link DatabaseException}]
   */
  public async update(find: Record<string, any>, update: Record<string, any>): Promise<Record<string, any>> {
    return this.updateWhere(this.equalsFilter(find), update);
  }

  /**
   * Update data in the model using the provided filter
   * @param filter The WHERE query to be used to find the data
   * @param update The data to be updated
   * @returns
   */
  public async updateWhere(filter: IDatabaseQueryFilterExpression, update: Record<string, any>): Promise<Record<string, any>> {
    this.checkIsReady();
    if (!update) throw new DatabaseException('Empty update!');
    if (this.isEmptyFilter(filter)) throw new DatabaseException('Empty filter! Updating without a filter is not allowed.');
    this.validFieldValueCheck(update);
    this.filterCheck(filter);
    const keys = Object.keys(update).filter((field) => !this.fields[field].autoIncrement);
    if (keys.length === 0) throw new DatabaseException('No updatable field has been provided! Auto increment fields cannot be updated.');
    const values = keys.map((fieldKey) => update[fieldKey] ?? null);
    return this.connection!.update(this.name!, keys, values, filter);
  }

  /**
   * Inserts data on database, if is duplicate updates the already existing row, if updateFields is an empty array and the row is duplicated, it does nothing and returns an empty array
   * @param data The data to be inserted
   * @param updateFields What fields to update if duplicated (undefined = all fields provided on data, empty array = none)
   * @returns The inserted or updated row, or an empty array when the row is duplicated and ignored (use `Array.isArray` to tell them apart)
   */
  public async upsert(data: Record<string, any>, updateFields?: string[]): Promise<Record<string, unknown> | []> {
    this.checkIsReady();
    this.validFieldsCheck(data);
    const keys = this.insertKeys(data);
    if (!Array.isArray(updateFields) && !updateFields) updateFields = keys.filter((fieldKey) => data[fieldKey] !== undefined);
    return this.connection!.upsert(this.name!, keys, Object.keys(this.fields), this.insertValues(data, keys), updateFields);
  }

  /**
   * Delete data in the model
   * @param find The query to be used to find the data
   * @returns affected rows
   * @throws [{@link DatabaseException}]
   */
  public async delete(find: Record<string, any>): Promise<number> {
    return this.deleteWhere(this.equalsFilter(find));
  }

  /**
   * Performs a delete query on the database with the provided filter
   * @param filter the WHERE clause of the delete query
   * @returns affected rows
   */
  public async deleteWhere(filter: IDatabaseQueryFilterExpression): Promise<number> {
    this.checkIsReady();
    if (this.isEmptyFilter(filter))
      throw new DatabaseException('Empty filter! If you want to delete all rows on this table call \'deleteAll\' instead.');
    this.filterCheck(filter);
    return this.connection!.delete(this.name!, filter);
  }

  /**
   * Deletes all rows in the table
   * @returns affected rows
   * @throws [{@link DatabaseException}]
   */
  public async deleteAll(): Promise<number> {
    this.checkIsReady();
    return this.connection!.delete(this.name!);
  }

  /**
   * Counts rows in the table, call without parameters to get the total amount of rows
   * 
   * Use the fields parameter to count the amount of rows within a specific column (without counting NULL values)
   * 
   * Pass an object with { key: string, distinct: true } on the fields array to only count unique values for that column (Example: [{ key: 'category', distinct: true}] will return how many different categories there is on the table)
   * 
   * Use the optional alias parameter to rename the column. Example, [{ key: 'category', distinct: true, alias: 'categoryCount'}] will return the object [{ categoryCount: 7 }].
   * 
   * Pass a filter to only count rows that match an specific criteria. Example, only count the rows where the column 'price' is greater than 50 will return how many items cost more than 50. 
   * 
   * Note: if fields is not provided, will return [{ count: number }]
   * @param fields
   */
  public async count(params?: { fields?: (IDatabaseCount | string)[], filter?: IDatabaseQueryFilterExpression }): Promise<Record<string, number>> {
    const fields = params?.fields ?? undefined;
    const filter = params?.filter ?? undefined;

    this.checkIsReady();
    this.filterCheck(filter);
    if (fields) this.fieldsCheck(fields.map((field) => typeof field === 'string' ? field : field.key));

    const finalFields: IDatabaseCount[] = fields?.map((field) => typeof field === 'string' ?
      { key: field, distinct: false, alias: field } : { alias: field.alias ?? field.key, ...field }) ?? [{ key: '*', distinct: false, alias: 'count' }];

    return this.connection!.count(this.name!, { fields: finalFields, filter });
  }
}
