const discord = require("discord.js");
const fs = require('fs');
const client = new discord.Client();

const supportedCommands = [
    is_askTheOracle, is_rollActionDice,
    aw_rollMoveDice,
    reconnectDiscordClient, exitProcess
].reduce((sc, fn) => {
    sc[fn.name] = fn;
    return sc;
}, {}); //TODO separate module

const supportedArgs = {
    [is_askTheOracle.name]: [
        oracleLookupTable.name,
        '0',
        '10',
        '25',
        '50',
        '75',
        '90',
        '100'
    ]
}

const prefixes = ['.']; //TODO user settings

const tokens = syncParseJson('tokens.json');
const oracles = parseOraclesJson(syncParseJson('oracles.json'));

const cmdJson = parseCmdJson(syncParseJson('commands.json'));

login();

function parseCmdJson(json) {
    const cmdJumps = {};
    const cmdData = {};

    const isMissing = (array) => !array || array.length < 1;
    const keysIncludes = (object, key) => Object.keys(object).includes(key);

    const parseJumps = (cmdKey) => {
        if (!keysIncludes(supportedCommands, cmdKey)) {
            console.warn(
                `Command ${cmdKey} is not supported. Skipping command.`
            );
            return;
        }
        const listener = supportedCommands[cmdKey];
        const aliases = json[cmdKey].aliases;
        if (isMissing(aliases)) {
            console.warn(
                `Command '${cmdKey}' does not have any aliases. ` +
                `Using '${cmdKey}' instead.`
            );
            cmdJumps[cmdKey] = listener;
        } else {
            aliases.forEach(alias => {
                if (cmdJumps.hasOwnProperty(alias)) {
                    console.warn(`'${cmdKey}' is attempting to assign duplicate alias '${alias}'. Skipping.`);
                    return;
                }
                cmdJumps[alias] = listener;
            });
        }
    };

    const parseArgLabels = (key) => json[key].argLabels || null;

    const parseArgJumps = (cmdKey) => {
        const group = json[cmdKey].argAliases;

        if (isMissing(group)) return null;

        const argJumps = {};

        const keys = Object.keys(group);
        keys.forEach(key => {
            const list = group[key];
            if (isMissing(list)) return;
            if (!supportedArgs[cmdKey].includes(key)) {
                console.warn(
                    `Command ${cmdKey}'s argument '${key}' ` +
                    `is not supported. Skipping aliases.`
                );
                return;
            }
            list.forEach(alias => {
                if (argJumps.hasOwnProperty(alias)) {
                    console.warn(`'${cmdKey}.${key}' is attempting to assign duplicate alias '${alias}'. Skipping.`);
                    return;
                }
                argJumps[alias] = key
            });
        });
        return argJumps;
    };

    Object.keys(json).forEach(cmdKey => {
        parseJumps(cmdKey);

        const argJumps = parseArgJumps(cmdKey);
        const argLabels = parseArgLabels(cmdKey);
        if (argJumps || argLabels) {
            cmdData[cmdKey] = {};
            const data = cmdData[cmdKey];
            if (argJumps) data.argJumps = argJumps;
            if (argLabels) data.argLabels = argLabels;
        }
    });

    return {
        cmdJumps: cmdJumps,
        cmdData: cmdData
    };
}

function parseOraclesJson(json) {
    json.map = {};
    json.forEach(oracle => {
        if (oracle.type) {
            console.info(`${oracle.title}: ${oracle.type}`)
            return; //TODO
        }
        if (!oracle.title) {
            console.warn(`Oracle at index ${i} is missing a title field.`);
            return;
        }

        const mapOracle = (s) => json.map[s.toLowerCase().replace(/\s/, '-')] = oracle;

        mapOracle(oracle.title);

        if (!oracle.aliases) return;
        oracle.aliases.forEach(e => mapOracle(e));
    });
    return json;
}

client.on('ready', () => {
    console.log('Ready.');
});

client.on('message', (msg) => {
    args = msg.content.split(' ');
    if (!prefixes.find(s => msg.content.startsWith(s)))
        return;
    const cmd = args[0].substring(1).toLowerCase();
    if (!cmdJson.cmdJumps[cmd]) {
        msg.channel.send(`${msg.author} Unrecognized command \`${cmd}\`.`);
        return;
    }
    try {
        cmdJson.cmdJumps[cmd](msg, args.slice(1));
    } catch (error) {
        msg.channel.send(`${msg.author} Error: ${error.message}.`);
        console.error(`Error encountered while handling '${msg.content}':`, error);
    }
});

function is_askTheOracle(msg, args) {
    const chan = msg.channel;
    const data = cmdJson.cmdData[is_askTheOracle.name];
    const argJumps = data.argJumps;
    const argLabels = data.argLabels;
    const invalidArgsMsg =
        msg.author +
        ' A likelihood is required. Please use a whole number between ' +
        '0-100 or one of the following:\n' +
        Object.keys(argJumps).map(s => '`' + s + '`').join(', ');
    if (args.length < 1) {
        chan.send(invalidArgsMsg)
        return;
    }
    if (matchArg(is_askTheOracle, args[0], oracleLookupTable)) {
        oracleLookupTable(msg, args.slice(1));
        return;
    }
    const likelihood = args[0].toLowerCase();
    const question = args.length > 2 ? args.slice(1).join(' ') : null;
    const odds = argJumps[likelihood] || Number(likelihood);
    if (odds == null || odds != ~~odds || odds < 0 || odds > 100) {
        chan.send(invalidArgsMsg);
        return;
    }

    likelihood = argLabels[odds];
    if (likelihood == null) {
        likelihood = `The result is **${odds}%** likely vs.`
    } else {
        likelihood = `The result is ${likelihood} (**${odds}%**) vs.`
    }
    const result = d(100);
    const resultMsg = `${likelihood} **${result}**\n`;
    if (question != null) {
        resultMsg += '"' + question + '"\n';
    }
    resultMsg += msg.author + ' ' +
        (result <= odds ? '**Yes**.' : '**No**.');
    chan.send(resultMsg);
}

function oracleLookupTable(msg, args) {
    if (args.length < 1) return; //TODO: Send error
    oracle = oracles.map[args[0]];
    const roll = d(oracle.d ? oracle.d : 100);
    const key = Object.keys(oracle.results).find(k => k >= roll);
    msg.channel.send(`${roll}: ${oracle.results[key]}`);
}

function resolveArg(cmdFn, argAlias) {
    return cmdJson.cmdData[cmdFn.name].argJumps[argAlias];
}

function matchArg(cmdFn, argAlias, argFn) {
    return resolveArg(cmdFn, argAlias) == argFn.name;
}

function d(sides, count = 1) {
    return rInt(1, sides, count);
}

function rInt(min, max, count = 1) {
    if (count == 1) return Math.floor(Math.random() * (max - min + 1)) + min;
    return Array.apply(null, Array(count)).map(n => rInt(min, max))
}

function is_rollActionDice(msg, args) {
    const chan = msg.channel;
    const mods = args.reduce(function (m, s) {
        const i = parseInt(s);
        return m + (i ? i : 0);
    }, 0);
    const challenge = d(10, 2);
    const action = d(6);
    const challengeStr = challenge.map(n => (action + mods) > n ? `__${n}__` : n);
    const modStr = args.reduce((s, n) => {
        const i = parseInt(n);
        if (!i && i !== 0) return s;
        return s + (i < 0 ? '-' : '+') + Math.abs(i)
    }, '');

    let result = `**${action + mods}**`;
    if (modStr) result += ` (**${action}**${modStr})`;
    result += ` vs. **${challengeStr[0]}** & **${challengeStr[1]}**`;

    //let success = challenge.reduce(n => (action + mods) > n ? 1 : 0, 0);
    let success = 0;
    for (let i = 0; i < challenge.length; i++) {
        if (action + mods > challenge[i])
            success++;
    }

    const successStr = ['Miss...', 'Weak hit!', '_Strong hit!_'][success];
    result += `\n${msg.author} ${successStr}`

    if (challenge[0] == challenge[1])
        result += ' _MATCH!_';
    chan.send(result)
}

function aw_rollMoveDice(msg, args) {
    var chan = msg.channel;
    var mods = args.reduce(function (m, s) {
        const i = parseInt(s);
        return m + (i ? i : 0);
    }, 0);
    var action = d(6, 2);
    const total = action[0] + action[1] + mods;
    var modStr = args.reduce((s, n) => {
        const i = parseInt(n);
        if (!i && i !== 0) return s;
        return s + ' ' + (i < 0 ? '-' : '+') + ' ' + Math.abs(i)
    }, '');
    var result = '' +
        `**${total}** (**${action[0]}** & **${action[1]}**${modStr})`

    var success;
    if (total <= 6) success = 0;
    else if (total <= 9) success = 1;
    else success = 2;
    var successStr = ["Miss...", "Mixed success!", "_Success!_"][success];
    result += `\n${msg.author} ${successStr}`

    chan.send(result)
}

function login() {
    client.login(tokens.discord.botAccount);
}

function reconnectDiscordClient(msg, args) {
    msg.channel.send('Resetting...')
        .then(() => client.destroy())
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

function syncParseJson(filename) {
    return JSON.parse(fs.readFileSync(filename, 'utf8'))
}