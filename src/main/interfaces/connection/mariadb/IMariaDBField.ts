import { EMariaDBFieldTypes } from '..';

export interface IMariaDBField {
  type: EMariaDBFieldTypes;
  attributes: string;
  typeSize?: number | [number, number];
  nullable: boolean;
  primaryKey: boolean;
  autoIncrement: boolean;
  unique: boolean;
  default?: unknown;
  foreignKey?: {
    table: string,
    field: string,
    onDelete?: 'CASCADE' | 'RESTRICT' | 'NO ACTION' | 'SET NULL',
    onUpdate?: 'CASCADE' | 'RESTRICT' | 'NO ACTION' | 'SET NULL',
  };
}
