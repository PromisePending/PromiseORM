import { IDatabaseOrderBy, IDatabaseQueryFilterExpression } from '../..';

export interface IDatabaseConnectionRead { 
  keys: ('*' | string[]),
  database: string,
  filter?: IDatabaseQueryFilterExpression,
  limit?: number,
  orderBy?: IDatabaseOrderBy | IDatabaseOrderBy[]
}
