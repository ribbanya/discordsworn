const discord = require('discord.js');
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
        is_oracleLookupTable.name,
        '0',
        '10',
        '25',
        '50',
        '75',
        '90',
        '100'
    ]
};

const supportedOracles = [null, 'multipleColumns']; //, 'nested'];

const prefixes = ['.']; //TODO user settings

function syncParseJson(filename) {
    return JSON.parse(fs.readFileSync(filename, 'utf8'));
}

const tokens = syncParseJson('tokens.json');
const oracles = parseOraclesJson(syncParseJson('oracles.json'));

const cmdJson = parseCmdJson(syncParseJson('commands.json'));

login();

function formatArg(arg) {
    return arg.toLowerCase().replace(/\s+/g, '-');
}

function formatArgList(argList) {
    return argList.map(a => '`' + a + '`').join(', ');
}

function parseCmdJson(json) {
    const cmdJumps = {};
    const cmdData = {};
    const cmdGroups = {};
    const cmdHelp = {};

    const isMissing = (array) => !array || array.length < 1;
    const keysIncludes = (object, key) => Object.keys(object).includes(key);

    const parseJumps = (cmdKey) => {

        const aliases = json[cmdKey].aliases;
        const listener = supportedCommands[cmdKey];

        cmdGroups[cmdKey] = aliases;

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
                alias = formatArg(alias);
                cmdJumps[alias] = listener;
            });
        }
    };

    const parseArgLabels = (cmdKey) => json[cmdKey].argLabels || null;

    const parseHelp = (cmdKey) => {
        const aliases = json[cmdKey].aliases;
        if (isMissing(aliases)) return;
        cmdHelp[cmdKey] = `${cmdKey}: ${formatArgList(aliases)}`;
    };
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
                    `Command ${cmdKey}'s argument '${key}'` +
                    'is not supported. Skipping aliases.'
                );
                return;
            }
            list.forEach(alias => {
                if (argJumps.hasOwnProperty(alias)) {
                    console.warn(`'${cmdKey}.${key}' is attempting to assign duplicate alias '${alias}'. Skipping.`);
                    return;
                }
                alias = formatArg(alias);
                argJumps[alias] = key;
            });
        });
        return argJumps;
    };

    Object.keys(json).forEach(cmdKey => {
        const cmd = json[cmdKey];
        if (!keysIncludes(supportedCommands, cmdKey)) {
            console.warn(
                `Command ${cmdKey} is not supported. Skipping command.`
            );
            return;
        }
        parseJumps(cmdKey);
        parseHelp(cmdKey);
        const argJumps = parseArgJumps(cmdKey);
        const argLabels = parseArgLabels(cmdKey);
        if (argJumps || argLabels || cmd.title || cmd.requiresOwner) {
            cmdData[cmdKey] = {};
            const data = cmdData[cmdKey];
            if (argJumps) data.argJumps = argJumps;
            if (argLabels) data.argLabels = argLabels;
            if (cmd.title) data.title = cmd.title;
            if (cmd.requiresOwner) data.requiresOwner = cmd.requiresOwner;
        }
    });

    return {
        cmdData: cmdData,
        cmdGroups: cmdGroups,
        cmdHelp: cmdHelp,
        cmdJumps: cmdJumps
    };
}

function parseOraclesJson(json) {
    json.map = {};
    for (let i = 0; i < json.length; i++) {
        const oracle = json[i];
        if (!oracle.title) {
            console.warn(`Oracle at index ${i} is missing a title field. Skipping.`);
            continue;
        }
        oracle.type = oracle.type || null;
        if (!supportedOracles.includes(oracle.type)) {
            console.warn(`Oracle "${oracle.title}"'s type '${oracle.type}' is not supported. Skipping.`);
            continue;
        }
        const mapOracle = (s) => {
            if (json.map.hasOwnProperty(s)) {
                console.warn(`Oracle '${oracle.title}' is attempting to assign duplicate alias '${s}'. Skipping.`);
                return;
            }
            s = formatArg(s);
            json.map[s] = oracle;
        };

        mapOracle(oracle.title);

        if (!oracle.aliases) continue;
        oracle.aliases.forEach(e => mapOracle(e));
    }
    return json;
}

client.on('ready', () => {
    console.log('Ready.');
});

client.on('message', (msg) => {
    const args = msg.content.split(' ');
    if (!prefixes.find(s => msg.content.startsWith(s)))
        return;
    const cmd = args[0].substring(1).toLowerCase();
    const cmdKey = cmdJson.cmdJumps[cmd];
    if (!cmdKey) {
        msg.channel.send(`${msg.author} Unrecognized command \`${cmd}\`.`);
        return;
    }

    if (cmdJson.cmdData[cmdKey.name].requiresOwner &&
        msg.author.id != tokens.discord.ownerId) {
        msg.channel.send(`${msg.author} You don't have permission to do that!`);
        return;
    }
    try {
        (cmdKey)(msg, args.slice(1));
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
        chan.send(invalidArgsMsg);
        return;
    }
    if (matchArg(is_askTheOracle, args[0], is_oracleLookupTable)) {
        is_oracleLookupTable(msg, args.slice(1));
        return;
    }

    let likelihood = args[0].toLowerCase();
    const question = args.length > 2 ? args.slice(1).join(' ') : null;
    const odds = argJumps[likelihood] || Number(likelihood);
    if (odds == null || odds != ~~odds || odds < 0 || odds > 100) {
        chan.send(invalidArgsMsg);
        return;
    }

    likelihood = argLabels[odds];
    if (likelihood == null) {
        likelihood = `The result is **${odds}%** likely vs.`;
    } else {
        likelihood = `The result is ${likelihood} (**${odds}%**) vs.`;
    }
    const result = d(100);
    let resultMsg = `${likelihood} **${result}**\n`;
    if (question != null) {
        resultMsg += '"' + question + '"\n';
    }
    resultMsg += msg.author + ' ' +
        (result <= odds ? '**Yes**.' : '**No**.');
    chan.send(resultMsg);
}

function is_oracleLookupTable(msg, args) {
    const oracleNotFoundMsg =
        'Please specify an Oracle from the list:\n' +
        Object.keys(oracles.map).map(s => '`' + s + '`').join(', ');
    if (args.length < 1) {
        msg.channel.send(`${msg.author} ${oracleNotFoundMsg}`);
        return;
    }
    const oracleName = args[0];
    const oracle = oracles.map[oracleName];
    if (!oracle) {
        msg.channel.send(`${msg.author} Oracle \`${oracleName}\` not found. ${oracleNotFoundMsg}`);
        return;
    }
    //TODO: Check for oracle.results
    const roll = d(oracle.d ? oracle.d : 100);
    let output = `Consulting the Oracle of **${oracle.title}** vs. **${roll}**…\n${msg.author} `;
    const key = Object.keys(oracle.results).find(k => k >= roll);
    switch (oracle.type) {
    case null:
        //TODO: Ensure sort of keys
        output += `**${oracle.results[key]}**.`;
        break;
    case 'multipleColumns':
        const list = [];
        for (let i = 0; i < oracle.results[key].length; i++) {
            let s = '';
            if (oracle.headers && i < oracle.headers.length) {
                s += `${oracle.headers[i]}: `;
            }
            s += `**${oracle.results[key][i]}**.`;
            list.push(s);
        }
        output += list.join(' ');
    }
    msg.channel.send(output);
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
    return Array.apply(null, Array(count)).map(() => rInt(min, max));
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
        return s + (i < 0 ? '-' : '+') + Math.abs(i);
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
    result += `\n${msg.author} ${successStr}`;

    if (challenge[0] == challenge[1])
        result += ' _MATCH!_';
    chan.send(result);
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
        return s + ' ' + (i < 0 ? '-' : '+') + ' ' + Math.abs(i);
    }, '');
    var result = '' +
        `**${total}** (**${action[0]}** & **${action[1]}**${modStr})`;

    var success;
    if (total <= 6) success = 0;
    else if (total <= 9) success = 1;
    else success = 2;
    var successStr = ['Miss...', 'Mixed success!', '_Success!_'][success];
    result += `\n${msg.author} ${successStr}`;

    chan.send(result);
}

function login() {
    client.login(tokens.discord.botAccount);
}

function reconnectDiscordClient(msg, _args) {
    msg.channel.send('Resetting...')
        .then(() => client.destroy())
        .then(() => login());
}

function exitProcess(msg, _args) {
    const a = msg.author;
    console.info(`Shutdown request received from ${a.id} (${a.username}#${a.discriminator}.)`);

    console.log('Shutting down.');
    msg.channel.send(`Shutting down at the request of ${msg.author}.`)
        .then(() => client.destroy())
        .then(() => process.exit(0));
}