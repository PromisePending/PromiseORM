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
    this.nonNullableFields = Object.keys(fields).filter((fieldKey) => !fields[fieldKey].nullable && !fields[fieldKey].autoIncrement && !fields[fieldKey].default);

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

  private validFieldValueCheck(data: Record<string, any>): void {
    const keys = Object.keys(data);
    this.fieldsCheck(keys);
    const nonNullCheck = keys.filter((key) => this.nonNullableFields.includes(key) && (data[key] == null || data[key] === ''));
    if (nonNullCheck.length > 0) throw new DatabaseException(`A null param was provided to a non-null field! Null was provided to the following non-null fields: ${nonNullCheck.join(', ')}`);
    keys.find((key) => {
      if (this.fields[key].type === EDatabaseTypes.SINT || this.fields[key].type === EDatabaseTypes.UINT) {
        if (typeof data[key] !== 'number') throw new DatabaseException(`Field ${key} has to be a number!`);
        if (Math.floor(data[key]) !== data[key]) throw new DatabaseException(`Field ${key} has to be an integer!`);
        if (this.fields[key].type === EDatabaseTypes.UINT && (data[key] < 0)) throw new DatabaseException(`Field ${key} cannot be negative as is unsigned!`);
        if (this.fields[key].minSize && data[key] < this.fields[key].minSize!) throw new DatabaseException(`Field ${key} has a minimum size of ${this.fields[key].minSize}!`);
        if (this.fields[key].maxSize && data[key] > this.fields[key].maxSize!) throw new DatabaseException(`Field ${key} has a maximum size of ${this.fields[key].maxSize}!`);
      }
      if (this.fields[key].type === EDatabaseTypes.BOOLEAN && typeof data[key] !== 'boolean') throw new DatabaseException(`Field ${key} has to be a boolean!`);
      if (this.fields[key].type === EDatabaseTypes.STRING && typeof data[key] !== 'string') throw new DatabaseException(`Field ${key} has to be a string!`);
      if (this.fields[key].type === EDatabaseTypes.DECIMAL) {
        if (typeof data[key] !== 'number') throw new DatabaseException(`Field ${key} has to be a number!`);
        if (this.fields[key].minSize && data[key] < this.fields[key].minSize!) throw new DatabaseException(`Field ${key} has a minimum size of ${this.fields[key].minSize}!`);
        if (this.fields[key].maxSize && data[key] > this.fields[key].maxSize!) throw new DatabaseException(`Field ${key} has a maximum size of ${this.fields[key].maxSize}!`);
      }
      return true;
    });
  }

  /**
   * @private
   * @throws [{@link DatabaseException}]
   */
  private validFieldsCheck(data: Record<string, any>): void {
    this.validFieldValueCheck(data);
    if (this.nonNullableFields.find((key) => (data[key] ?? this.fields[key].default) == null))
      throw new DatabaseException(`A non nullable field has not been provided! ${this.nonNullableFields.join(', ')}`);
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
        const data = { [(filterElement as IDatabaseQueryFilter).tableKey]: (filterElement as IDatabaseQueryFilter).value };
        this.validFieldValueCheck(data);
      }
    });
  }

  /**
   * Find data in the model
   * @param query The query to be used to find the data
   * @returns The data found
   * @throws [{@link DatabaseException}]
   */
  public async find(params?: { query?: Record<string, any>, limit?: number, orderBy?: IDatabaseOrderBy }): Promise<Record<string, unknown>[]> {
    const { query, limit, orderBy } = params || {};
    this.checkIsReady();
    return this.connection!.read({ keys: '*', database: this.name!,
      filter: (query
        ? {
          type: 'AND',
          filters: Object.keys(query).map((fieldKey) => ({
            tableKey: fieldKey,
            operator: EDatabaseQueryFilterOperator.EQUALS,
            value: query[fieldKey],
          })),
        }
        : undefined),
      limit,
      orderBy,
    });
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
  public async findByID(id: string, fieldName?: string): Promise<Record<string, unknown> | undefined> {
    return this.findOne({ [fieldName ?? 'id']: id });
  }

  /**
   * Select data in the model
   * @param fields list of filed keys to be selected
   * @param filter WHERE clause of the select query
   * @param limit amount of rows to be selected
   * @returns The data found
   * @throws [{@link DatabaseException}]
   */
  public async select(params: { fields: string[], filter?: IDatabaseQueryFilterExpression, limit?: number, orderBy?: IDatabaseOrderBy },
  ): Promise<Record<string, unknown>[]> {
    this.checkIsReady();
    if (!params) throw new DatabaseException('Missing params for \'select\' method call, if you want to retrieve all data on this table call \'find\' instead.');
    const { fields, filter, limit, orderBy } = params;
    this.fieldsCheck(fields);
    this.filterCheck(filter);
    return this.connection!.read({ keys: fields, database: this.name!, filter, limit, orderBy });
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
    const keys = Object.keys(this.fields).filter((field) => !this.fields[field].autoIncrement);
    const values = keys.map((fieldKey) => data[fieldKey] ?? this.fields[fieldKey].default ?? null);
    return this.connection!.create(this.name!, keys, Object.keys(this.fields), values);
  }

  /**
   * Update data in the model
   * @param find The query to be used to find the data
   * @param update The data to be updated
   * @throws [{@link DatabaseException}]
   */
  public async update(find: Record<string, any>, update: Record<string, any>): Promise<Record<string, any>> {
    const filter: IDatabaseQueryFilterExpression = {
      type: 'AND',
      filters: Object.keys(find).map((fieldKey) => ({
        tableKey: fieldKey,
        operator: EDatabaseQueryFilterOperator.EQUALS,
        value: find[fieldKey],
      })),
    };
    return this.updateWhere(filter, update);
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
    this.validFieldValueCheck(update);
    this.filterCheck(filter);
    const keys = Object.keys(update).filter((field) => !this.fields[field].autoIncrement);
    const values = keys.map((fieldKey) => update[fieldKey] ?? null);
    return this.connection!.update(this.name!, keys, values, filter);
  }

  /**
   * Inserts data on database, if is duplicate updates the already existing row, if updateFields is an empty array and the row is duplicated, it does nothing and returns an empty array
   * @param data The data to be inserted
   * @param updateFields What fields to update if duplicated (undefined = all of them, empty array = none)
   */
  public async upsert(data: Record<string, any>, updateFields?: string[]): Promise<Record<string, unknown>> {
    this.checkIsReady();
    this.validFieldValueCheck(data);
    const keys = Object.keys(this.fields).filter((field) => !this.fields[field].autoIncrement);
    if (!Array.isArray(updateFields) && !updateFields) updateFields = keys;
    const values = keys.map((fieldKey) => data[fieldKey] ?? null);
    return this.connection!.upsert(this.name!, keys, Object.keys(this.fields), values, updateFields);
  }

  /**
   * Delete data in the model
   * @param find The query to be used to find the data
   * @returns affected rows
   * @throws [{@link DatabaseException}]
   */
  public async delete(find: Record<string, any>): Promise<number> {
    this.checkIsReady();
    this.validFieldValueCheck(find);
    const filter: IDatabaseQueryFilterExpression = {
      type: 'AND',
      filters: Object.keys(find).map((fieldKey) => ({
        tableKey: fieldKey,
        operator: EDatabaseQueryFilterOperator.EQUALS,
        value: find[fieldKey],
      })),
    };
    return this.connection!.delete(this.name!, filter);
  }

  /**
   * Performs a delete query on the database with the provided filter
   * @param filter the WHERE clause of the delete query
   * @returns affected rows
   */
  public async deleteWhere(filter: IDatabaseQueryFilterExpression): Promise<number> {
    this.checkIsReady();
    this.filterCheck(filter);
    return this.connection!.delete(this.name!, filter);
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
