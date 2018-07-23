const discord = require("discord.js");
const fs = require('fs');
const client = new discord.Client();

const supportedCommands = {
    [askTheOracle.name]: askTheOracle,
    [rollActionDice.name]: rollActionDice,
    [reconnectDiscordClient.name]: reconnectDiscordClient,
    [exitProcess.name]: exitProcess
};

const supportedArgs = {
    [askTheOracle.name]: [
        'lookupTable',
        '0',
        '10',
        '25',
        '50',
        '75',
        '90',
        '100'
    ]
}

const prefixes = ['.'];

const tokens = syncParseJSON('tokens.json');
const oracles = parseOracles('oracles.json');
const cmdTable = parseCommands('commands.json', supportedCommands, supportedArgs);
login();

function parseCommands(filename) {
    const json = syncParseJSON(filename);
    parseAliases(json);
    return cmdListeners;
}

function parseAliases(json) {
    const cmdListeners = {};
    const jsonKeys = Object.keys(json);
    for (let i = 0; i < jsonKeys.length; i++) {
        const cmdKey = jsonKeys[i]
        if (keysIncludes(supportedCommands, cmdKey)) {
            console.warn(
                `Command ${cmdKey} is not supported. Skipping command.`
            );
            continue;
        }
        const cmdValue = json[cmdKey];
        //TODO: Arguments from json
        const listener = supportedCommands[cmdKey].listener;
        const aliases = cmdValue.aliases;
        if (!isNullOrEmpty(aliases)) {
            for (let i = 0; i < aliases.length; i++) {
                cmdListeners[aliases[i]] = listener;
            }
        } else {
            console.warn(
                `Command '${cmdKey}' does not have any aliases. ` +
                `Using '${cmdKey}' instead.`
            );
            cmdListeners[cmdKey] = listener;
        }

        var returnMe = parseArgAliases(json, cmdKey)
    }
}


function parseArgAliases(json, cmdKey) {
    const entries = json[cmdKey].argAliases.entries();
  
    if (isNullOrEmpty(entries)) return;

    return entries.reduce((table, kvp) => {
        const argKey = kvp[0]
        if (!keysIncludes(supportedArgs, argKey)) {
            console.warn(
                `Command ${cmdKey}'s argument '${argKey}' ` +
                `is not supported. Skipping aliases.`
            );
            return table;
        }
        kvp[1].forEach(argAlias => table[argAlias] = argKey);
    });
}

function isNullOrEmpty(array) {
    return !array || array.length < 1;
}

function keysIncludes(object, key) {
    return Object.keys(object).includes(key);
}

function parseOracles(filename) {
    const json = syncParseJSON(filename);
    json.map = {};
    for (let i = 0; i < json.length; i++) {
        let oracle = json[i];

        if (oracle.type) {
            console.info(`${oracle.title}: ${oracle.type}`)
            continue; //TODO
        }
        if (!oracle.title) {
            console.warn(`Oracle at index ${i} is missing a title field.`);
            continue;
        }
        json.map[formatAlias(oracle.title)] = oracle;

        if (!oracle.aliases) continue;

        for (let i = 0; i < oracle.aliases.length; i++) {
            json.map[formatAlias(oracle.aliases[i])] = oracle;
        }
    }
    return json;
}

function formatAlias(s) {
    return s.toLowerCase().replace(/\s/, '-');
}

client.on('ready', () => {
    console.log('Ready.');
});

client.on('message', (msg) => {
    args = msg.content.split(' ');
    const chan = msg.channel;
    var prefixMatch = false;
    for (let i = 0; i < prefixes.length; i++) {
        if (msg.content.startsWith(prefixes[i])) {
            prefixMatch = true;
            break;
        }
    }
    if (!prefixMatch) return;
    var cmd = args[0].substring(1).toLowerCase();
    cmdTable[cmd](msg, args.slice(1));
});

function askTheOracle(msg, args) {
    const chan = msg.channel;
    const tierMap = {
        'almost-certain': 90,
        'ac': 90,
        'likely': 75,
        'l': 75,
        '50-50': 50,
        'unlikely': 25,
        'ul': 25,
        'small-chance': 10,
        'sc': 10
    };
    const oddsMap = {
        90: 'almost certain',
        75: 'likely',
        50: '50-50',
        25: 'unlikely',
        10: 'highly unlikely'
    }
    const invalidArgsMsg =
        msg.author +
        ' A likelihood is required. Please use a whole number between ' +
        '0-100 or one of the following:\n' +
        Object.keys(tierMap).map(s => '`' + s + '`').join(', ');
    if (args.length < 1) {
        chan.send(invalidArgsMsg)
        return;
    }
    if (args[0] == 'table' | args[0] == 't') {
        askTable(msg, args.slice(1));
        return;
    }
    var likelihood = args[0].toLowerCase();
    var question = args.length > 2 ? args.slice(1).join(' ') : null;
    var odds = tierMap[likelihood] || Number(likelihood);
    if (odds == null || odds != ~~odds || odds < 0 || odds > 100) {
        chan.send(invalidArgsMsg);
        return;
    }

    likelihood = oddsMap[odds];
    if (likelihood == null) {
        likelihood = `The result is **${odds}%** likely vs.`
    } else {
        likelihood = `The result is ${likelihood} (**${odds}%**) vs.`
    }
    var result = d(100);
    var resultMsg = `${likelihood} **${result}**\n`;
    if (question != null) {
        resultMsg += '"' + question + '"\n';
    }
    resultMsg += msg.author + ' ' +
        (result <= odds ? '**Yes**.' : '**No**.');
    chan.send(resultMsg);
}

function askTable(msg, args) {
    if (args.length < 1) return; //TODO: Send error
    oracle = oracles.map[args[0]];
    const roll = d(oracle.d ? oracle.d : 100);

    var k;
    for (k in oracle.results) {
        console.info(`${roll}? ${k}=${oracle.results[k]}`);
        if (k >= roll) break;
    }
    msg.channel.send(`${roll}: ${oracle.results[k]}`);


    // var result;
    // for (let i = 0; i < oracle.results.length; i++) {
    //     const r = oracle.results[i];
    //     if ()
    // }

    //msg.channel.send(result);
}

function d(sides, count = 1) {
    return rInt(1, sides, count);
}

function rInt(min, max, count = 1) {
    if (count == 1) return Math.floor(Math.random() * (max - min + 1)) + min;
    return Array.apply(null, Array(count)).map(n => rInt(min, max))
}

function rollActionDice(msg, args) {
    var chan = msg.channel;
    var mods = args.reduce(function (m, s) {
        var i = parseInt(s);
        if (!i) return m;
        return m + i;
    }, 0);
    var challenge = d(10, 2);
    var action = d(6);
    var challengeStr = challenge.map(n => (action + mods) > n ? `__${n}__` : n);
    modStr = args.length > 0 ? args.reduce((m, s) => {
        if (parseInt(s))
            m.push(s);
        return m;
    }, []).join('+') : '0';
    var result = '' +
        `**${action + mods}** (**${action}**+${modStr})` +
        ` vs. **${challengeStr[0]}** & **${challengeStr[1]}**`;

    //var success = challenge.reduce(n => (action + mods) > n ? 1 : 0, 0);
    var success = 0;
    for (var i = 0; i < challenge.length; i++) {
        if (action + mods > challenge[i])
            success++;
    }

    var successStr = ['Miss...', 'Weak hit!', '_Strong hit!_'][success];
    result += `\n${msg.author} ${successStr}`

    if (challenge[0] == challenge[1])
        result += ' _MATCH!_';
    chan.send(result)
}

function login() {
    client.login(tokens.discord.botAccount);
}

function reconnectDiscordClient(msg, args) {
    msg.channel.send('Resetting...')
        .then(msg => client.destroy())
        .then(() => login());
}

function exitProcess(msg, args) {
    const a = msg.author;
    console.info(`Shutdown request received from ${a.id} (${a.username}#${a.discriminator}.)`);
    if (a.id != tokens.discord.ownerId)
        return;

    console.log('Shutting down.');
    msg.channel.send(`Shutting down at the request of ${msg.author}.`)
        .then(() => client.destroy())
        .then(() => process.exit(0));
}

function syncParseJSON(filename) {
    return JSON.parse(fs.readFileSync(filename, 'utf8'))
}