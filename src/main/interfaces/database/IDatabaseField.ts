import { EDatabaseTypes } from './EDatabaseTypes';
import { BaseModel } from '../../models';

type ForeignKeyOptions = {
  table: BaseModel,
  field: string,
  onDelete?: 'CASCADE' | 'RESTRICT' | 'NO ACTION' | 'SET NULL',
  onUpdate?: 'CASCADE' | 'RESTRICT' | 'NO ACTION' | 'SET NULL',
};

export type IDatabaseField = 
  | {
      type: EDatabaseTypes.BOOLEAN;
      nullable: boolean;
      default?: any;
      autoIncrement?: boolean;
      primaryKey?: boolean;
      foreignKey?: ForeignKeyOptions;
    }
  | {
      type: EDatabaseTypes.TIMESTAMP;
      maxSize?: number;
      minSize?: number;
      nullable: boolean;
      unique?: boolean;
      default?: any;
      autoIncrement?: boolean;
      primaryKey?: boolean;
      foreignKey?: ForeignKeyOptions;
    }
  | {
      type: Exclude<Exclude<EDatabaseTypes, EDatabaseTypes.BOOLEAN>, EDatabaseTypes.TIMESTAMP>;
      maxSize: number;
      minSize?: number;
      nullable: boolean;
      unique?: boolean;
      default?: any;
      autoIncrement?: boolean;
      primaryKey?: boolean;
      foreignKey?: ForeignKeyOptions;
    };
