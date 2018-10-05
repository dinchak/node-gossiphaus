# gossiphaus
Integration for the [gossip MUD protocol](https://gossip.haus/), a scrappy start-up inter-MUD communication protocol.

## Installation
`npm install gossiphaus`

## Debugging
Run with `DEBUG=gossiphaus` to see debug messages, ie:
`DEBUG=gossiphaus node example.js`

## Example
```javascript
const gossiphaus = require('gossiphaus')

run()

async function run() {
  try {
    // initialize with a configuration object.  your client_id and
    // client_secret are the minimum required parameters.
    let emitter = gossiphaus.init({
      client_id: '12345678-1234-1234-1234-123456789abc',
      client_secret: '12345678-1234-1234-1234-123456789abc'
    })

    // catch asynchronous errors
    emitter.on('error', (err) => {
      console.log(err.stack)
    })

    // connect to gossiphaus and retrieve current game status
    await gossiphaus.connect()

    // an array of other games connected to the gossip network with their
    // currently authenticated players
    console.log(gossiphaus.games)  

    // notify gossip of a new player authenticated into your game
    let result = await gossiphaus.addPlayer('SomePlayer')

    // subscribe your game to the 'secrets' channel
    result = await gossiphaus.send('channels/subscribe', {
      channel: 'secrets'
    })

    // send a message to the 'secrets' channel
    result = await gossiphaus.send('channels/send', {
      channel: 'secrets',
      name: 'SomePlayer',
      message: 'shhh'
    })

    // unsubscribe from the 'secrets' channel
    result = await gossiphaus.send('channels/unsubscribe', {
      channel: 'secrets'
    })

    // send a tell to a remote user
    result = await gossiphaus.send('tells/send', {
      from_name: 'SomePlayer',
      to_game: 'SomeGame',
      to_name: 'SomeOtherPlayer',
      sent_at: new Date(),
      message: 'test'
    })

    // notify gossip of a new player logged out of your game
    result = await gossiphaus.removePlayer('SomePlayer')

    // forcibly close the connection
    gossiphaus.close()

  // catch synchronous errors (ie. as the result of a send())
  } catch (err) {
    console.log(err.stack)
  }
}
```

## API

### gossiphaus.init(config)
Initializes gossiphaus configuration.  Returns an event emitter object that will report asynchronous errors.  You should listen for the `error` event of this emitter object to catch asynchronous errors (ie. socket unexpectedly closed, reconnection failures).

* `config.client_id` {string} Your game's client_id from gossip.haus (**required**)
* `config.client_secret` {string} Your game's client_secret from gossip.haus (**required**)
* `config.statusWait` {Number} How long to wait and collect status messages on connect before resolving (in ms), default: **100**
* `config.reconnectIntervalTime` {Number} How long to wait in between reconnection attempts (in ms), default: **5000**
* `config.url` {string} gossip.haus websocket url, default: **wss://gossip.haus/socket**
* `config.supports` {Array.<string>} Supported methods, default: **['channels', 'players', 'tells']**
* `config.channels` {Array.<string>} Channels to subscribe to, default: **['testing', 'gossip']**
* `config.version` {string} API version number to use, default not set
* `config.user_agent` {string} Game user agent, default not set

### gossiphaus.connect()
Connects to gossip.haus, authenticates, and gets the status of current remotely connected games.  Returns a promise that resolves after `config.statusWait`.  The delay allows remote game status to accumulate and be available when the promise resolves.

### gossiphaus.close()
Closes the connection with gossip.haus.  Connection can be re-established with `gossiphaus.connect()`.

### gossiphaus.send(event, payload, ref = true)
Sends an event to gossip.haus.  See (the documentation)[https://gossip.haus/docs] for information on the messages that can be sent.  Returns a promise that resolves with the acknowledgement packet.

* `event` {string} The gossip.haus event name (**required**)
* `payload` {Object} The gossip.haus event payload object (**required**)
* `ref` {boolean} If a ref id should be generated with this request, default: **true**

### gossiphaus.addPlayer(name)
Adds a player to your local game and informs the gossip.haus network.  This should be called when a user logs in to your game.  You should use this method instead of calling `send('players/sign-in')` directly so that `heartbeat` responses have an up-to-date player list.

* `name` {string} The player's name (**required**)

### gossiphaus.removePlayer(name)
Removes a player from your local game and informs the gossip.haus network.  This should be called when a user logs out of your game.  You should use this method instead of calling `send('players/sign-out')` directly so that `heartbeat` responses have an up-to-date player list.

* `name` {string} The player's name (**required**)

### gossiphaus.games
An array of remote game objects.  This object will be initialized as part of the `connect()` method and will be kept in sync when remote `players/sign-in` and `players/sign-out` messages are received.  The `config.statusWait` parameter controls how long to wait for this object to be populated.