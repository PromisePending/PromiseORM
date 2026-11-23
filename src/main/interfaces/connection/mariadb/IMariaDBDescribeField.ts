import { EMariaDBFieldTypes } from '..';

type IntegerType = Lowercase<`${EMariaDBFieldTypes.tinyint | EMariaDBFieldTypes.smallint | EMariaDBFieldTypes.mediumint | EMariaDBFieldTypes.int | EMariaDBFieldTypes.bigint}`>;
type Unsigned = ' unsigned' | '';
type OnUpdate = `on update ${'current_timestamp' | 'CURRENT_TIMESTAMP'}${`(${number | ''})` | ''}`;

export interface IMariaDBDescribeField {
  Field: string;
  Type:
    | `${IntegerType}${`(${number})` | ''}${Unsigned}`
    | `${Lowercase<EMariaDBFieldTypes.decimal>}(${number},${number})${Unsigned}`
    | `${Lowercase<EMariaDBFieldTypes.string>}(${number})`
    | `${Lowercase<EMariaDBFieldTypes.timestamp>}${`(${number})` | ''}`;
  Null: 'YES' | 'NO';
  Key: 'PRI' | 'UNI' | 'MUL' | '';
  Default: string | null;
  Extra: '' | 'auto_increment' | 'DEFAULT_GENERATED' | OnUpdate | `DEFAULT_GENERATED ${OnUpdate}`;
}
