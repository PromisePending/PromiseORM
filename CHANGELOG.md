# v1.1.1

- Fix: Select with filter doesn't work if the value of the field 'value' is falsy

# v1.1.0

- Feat: Better type on BaseModel creation

- Fix: Can't initialize orm when foreign keys are present due to wrong foreign key names

- Fix: Multiple primary keys not being created due to wrong handling of primary key fields

- Fix: Parsing of unique keys and foreign keys when updating tables

- BREAKING: Changed constructor of MariaDBConnection to accept an object instead of multiple parameters

# v1.0.6

- Fix: Can't create tables with foreign keys due to invalid syntax for ON DELETE and ON UPDATE clauses

# v1.0.5

- Fix: Can't connect to MySql instances due to missing allowPublicKeyRetrieval: true in connection options

# v1.0.4

- NOTICE: Rebranding 'promisedb' to 'promiseorm'
- CI: Add CI

# v1.0.3

- Fix: Register schema not awaiting before returning

- Fix: Update now returns updated row, if nothing got updated it returns undefined

- Fix: Update now doesn't requires the whole row to be passed to be updated, and now will accept updating fields based on the passed search params
