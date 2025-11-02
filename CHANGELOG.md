# v1.2.2

- Fix: Wrong data return behavior on 'Create' and 'Upsert' methods due to different versions of MariaDB.

- Fix: Incorrectly checking of MariaDB's version, that caused misbehavior on major versions of MariaDB equal or superior to 11 if the minor version was less than 5.

- Fix(typo): Improved non-null check message, fixed orthography and added more context to the error.

# v1.2.1

- Feat: New 'Count' method that allows the counting of how many rows are in a table, how many not null columns, distinct values of a column and set a custom name for the count key in the result object.

- Fix(types): Fix typing mistake that caused an regression forcing an object to be passed to 'Find', calling this method without any argument will behave the same way as passing an empty object.
  - This is a typing only mistake, that doesn't change how the method behave or parse its parameters.

# v1.2.0

- Feat: 'Select' and 'Find' methods can now receive an orderBy parameter to order the return the results from the database.

- BREAKING: 'Select' and 'Find' now receive an object as parameter instead of separated params.

# v1.1.1

- Fix: Select with filter doesn't work if the value of the field 'value' is falsy.

- Fix(types): Small fix on timestamp and boolean types.

# v1.1.0

- Feat: Better type on BaseModel creation.

- Fix: Can't initialize orm when foreign keys are present due to wrong foreign key names.

- Fix: Multiple primary keys not being created due to wrong handling of primary key fields.

- Fix: Parsing of unique keys and foreign keys when updating tables.

- BREAKING: Changed constructor of MariaDBConnection to accept an object instead of multiple parameters.

# v1.0.6

- Fix: Can't create tables with foreign keys due to invalid syntax for ON DELETE and ON UPDATE clauses.

# v1.0.5

- Fix: Can't connect to MySql instances due to missing allowPublicKeyRetrieval: true in connection options.

# v1.0.4

- NOTICE: Rebranding 'promisedb' to 'promiseorm'.

- CI: Add CI.

# v1.0.3

- Fix: Register schema not awaiting before returning.

- Fix: Update now returns updated row, if nothing got updated it returns undefined.

- Fix: Update now doesn't require the whole row to be updated to be passed, and now will accept updating fields based on the passed search params.
