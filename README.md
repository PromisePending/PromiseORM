<h1 align="center">PromiseORM</h1>

<p align="center">
  <a href="">
    <img src="https://img.shields.io/github/license/PromisePending/PromiseORM?style=flat-square&color=0394fc" alt="License" />
  </a>
  <a href="https://discord.gg/qUMUJW2XgF">
    <img src="https://img.shields.io/discord/866707606433562634?style=flat-square&color=7289da&logo=discord&logoColor=FFFFFF"/>
  </a>
</p>

#

<h2 align="center">📖 About</h2>

&nbsp;&nbsp;&nbsp;&nbsp;PromiseORM is a Typescript ORM for automatic creation and management of models and entries from simple objects and arrays.
It is designed to be used with any database, but currently only implements MariaDB/MySQL.

## Usage

```typescript
import { DatabaseManager, MariaDBConnection, BaseModel, EDatabaseTypes } from 'promiseorm';
// const { DatabaseManager, MariaDBConnection, BaseModel, EDatabaseTypes } = require('promiseorm');

// if you're only going to have a single connection you may pass it as parameter in DatabaseManager constructor and it will automatically register it under the name 'default'
const dbmgr = new DatabaseManager();
const mariadb = new MariaDBConnection({ hostname: 'localhost', port: 3306, username: 'username', password: 'password', database: 'database' });
await dbmgr.registerConnection('prodmaria', mariadb);

// You can also extends BaseModel in a class and pass the params to super() if you wish to instantiate your models all a once somewhere else.
const iceCreamModel = new BaseModel({
    flavor: {
        type: EDatabaseTypes.STRING,
        maxSize: 50, // 50 characters string
        nullable: false,
        unique: true,
        primaryKey: true,
    },
    calories: {
        type: EDatabaseTypes.UINT, // Unsigned integer
        maxSize: 30_000, // 30,000 calories max (max integer value, not byte size!)
        minSize: 0,
        primaryKey: false,
        autoIncrement: false,
    },
    price: {
        type: EDatabaseTypes.DECIMAL,
        maxSize: 999.99, // $999.99
        minSize: 0, // $0.00
        nullable: false,
    },
});

// Optionally, you can use the MariaDBConnection instance object instead of calling get connection.
const iceModel = await dbmgr.getConnection('prodmaria').registerModel('icecream', iceCreamModel);
iceModel.create({
    flavor: 'chocolate',
    calories: 250,
    price: 9.99,
}).then(async () => {
    console.log('Successfully created item on database!');
    console.log(await iceModel.findOne({ flavor: 'chocolate' }));
});

/* Output:

> Successfully created item on database!
{ flavor: 'chocolate', calories: 250, price: '9.99' }

*/
```

<h2 align="center">📝 License</h2>

&nbsp;&nbsp;&nbsp;&nbsp;This project is licensed under the GPL-3.0 License - see the [LICENSE](/LICENSE) file for details.

<br>

<h2 align="center">📜 Changelog</h2>

&nbsp;&nbsp;&nbsp;&nbsp;You can find the full changelog under the markdown [CHANGELOG.md](/CHANGELOG.md) file.

<br>

<h2 align="center">🤝 Contributing</h2>

&nbsp;&nbsp;&nbsp;&nbsp;Contributions is what makes the open source community an amazing place and its a wonderful place to learn, inspire and create. Any contribution you make will be **very much appreciated**.

1. Make a Fork of the Project
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

<br>

<h2 align="center">😉 Authors</h2>

<br>

<table align="center">
  <tr>
    <td align="center">
      <a href="https://github.com/LoboMetalurgico">
        <img src="https://avatars.githubusercontent.com/u/43734867?v=4" width="100px;" alt="LoboMetalurgico's GitHub profile logo"/>
        <br />
        <sub>
          <b>LoboMetalurgico</b>
        </sub>
      </a>
    </td>
    <td align="center">
      <a href="https://github.com/spacefox1">
        <img src="https://avatars.githubusercontent.com/u/44732812?v=4" width="100px;" alt="SpaceFox's GitHub profile logo"/>
        <br />
        <sub>
          <b>SpaceFox</b>
        </sub>
      </a>
    </td>
  </tr>
</table>

#

<p align="center">Made with 💜 By PromisePending™'s team.</p>
