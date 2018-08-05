const discord = require('discord.js');
const fs = require('fs');
const ws = require('ws');
const dateFormat = require('dateformat');
const Dice = require('node-dice-js');

const client = new discord.Client(); {
    client.on('ready', function onReady() { console.log('Ready.'); });
    client.on('message', onMsg);
    client.on('error', function onError(error) {
        console.error(error);
        if (error.target instanceof ws) {
            if (error.target.readyState === ws.CLOSED) {
                console.info('WebSocket closed unexpectedly. Reestablishing connection...');
                client.destroy().then(() => login());
            }
        }
    });
}

const supportedCommands = [
    is_askTheOracle, is_rollActionDice,
    aw_rollMoveDice,
    rollDice,
    helpMessage,
    reconnectDiscordClient, exitProcess
].reduce((sc, fn) => {
    sc[fn.name] = fn;
    return sc;
}, {}); //TODO separate module

const supportedArgs = {
    [is_askTheOracle.name]: [
        is_oracleLookupTable.name,
        '0', '10', '25', '50', '75', '90', '100'
    ]
};

const supportedOracles = [null, 'multipleColumns', 'nested'];

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

function parseCmdJson(json) {
    const cmdJumps = {};
    const cmdData = {};

    const isMissing = (array) => !array || array.length < 1;
    const keysIncludes = (object, key) => Object.keys(object).includes(key);

    const parseJumps = (cmdKey) => {

        const aliases = json[cmdKey].aliases;
        const listener = supportedCommands[cmdKey];

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
        const argJumps = parseArgJumps(cmdKey);
        const argLabels = parseArgLabels(cmdKey);
        if (argJumps || argLabels || !isMissing(cmd.aliases) ||
            cmd.title || cmd.helpText || cmd.description ||
            cmd.requiresOwner) {
            cmdData[cmdKey] = {};
            const data = cmdData[cmdKey];
            if (argJumps) data.argJumps = argJumps;
            if (argLabels) data.argLabels = argLabels;
            if (!isMissing(cmd.aliases)) data.aliases = cmd.aliases;
            if (cmd.title) data.title = cmd.title;
            if (cmd.helpText) data.helpText = cmd.helpText;
            if (cmd.description) data.description = cmd.description;
            if (cmd.requiresOwner) data.requiresOwner = cmd.requiresOwner;
        }
    });

    return {
        cmdData: cmdData,
        cmdJumps: cmdJumps
    };
}

function parseOraclesJson(json) {
    json.map = {};
    root: for (let i = 0; i < json.length; i++) {
        const oracle = json[i];
        oracle.type = oracle.type || null;
        let identifier = `Oracle at index ${i}`;
        const warn = (s) => console.warn(`${identifier}` + s + ' Skipping.');
        {
            if (!oracle.title) {
                warn(' is missing a title field.');
                continue;
            }

            identifier = `Oracle '${oracle.title}' at index ${i}`;

            if (!supportedOracles.includes(oracle.type)) {
                warn(`'s type '${oracle.type}' is not supported.`);
                continue;
            }

            const results = oracle.results;
            {
                let d = oracle.d;
                if (d && !parseInt(d)) {
                    warn(`'s 'd' value ('${d}') is not an integer.`);
                    continue;
                }
                if (!d) d = 100;

                const keys = Object.keys(results);
                for (let i = 0; i < keys.length; i++) {
                    const key = parseInt(keys[i]);
                    const keyId = `'s results key '${key}'`;
                    if (!key) {
                        warn(`${keyId} is not an integer`);
                        continue root;
                    }

                    if (keyId < 1) {
                        warn(`${keyId} is below the minimum value (1).`);
                        continue root;
                    }
                    if (keyId > d) {
                        warn(`${keyId} is above the maximum (${d}).`);
                        continue root;
                    }
                }
            }

            if (!(results && typeof results === 'object')) {
                warn(' does not have any results.');
                continue;
            }
        }
        if (oracle.aliases && !(oracle.aliases instanceof Array)) {
            warn(' has an \'aliases\' definition but it is not an Array.');
            continue;
        }
        const mapOracle = (s) => {
            if (json.map.hasOwnProperty(s)) {
                warn(` is attempting to assign duplicate alias '${s}'. Skipping.`);
                return;
            }
            s = formatArg(s);
            json.map[s] = oracle;
        };

        const title = formatArg(oracle.title);
        mapOracle(title);
        if (oracle.aliases && oracle.aliases.length > 0) {
            oracle.aliases.forEach(e => mapOracle(e));
        }
    }
    return json;
}


function onMsg(msg) {
    if (msg.author.id === client.user.id) return;

    const mention = new RegExp(`<@.?${client.user.id}>`, 'g');
    let content = msg.content.replace(mention, '')
        .replace(/ {2,}/, ' ').trim();
    {
        const hasPrefix = prefixes.find((prefix) => {
            if (content.startsWith(prefix)) {
                content = content.substring(prefix.length);
                return true;
            }
            return false;
        });
        const relevant = hasPrefix ||
            msg.isMentioned(client.user) ||
            msg.channel instanceof discord.DMChannel;

        if (!relevant) return;
    }

    const args = content.split(' ');
    const cmdKey = args[0].toLowerCase();
    const cmdFn = cmdJson.cmdJumps[cmdKey];

    if (!cmdFn) return;

    {
        const date = dateFormat(Date.now(), 'mm/dd/yy HH:MM:ss');
        const user = `${msg.author.username}#${msg.author.discriminator}`;
        console.info(`[${date}] ${user} (${msg.channel.type}): ${msg.content}`);
    }

    if (cmdJson.cmdData[cmdFn.name].requiresOwner &&
        msg.author.id != tokens.discord.ownerId) {
        msg.channel.send(`${msg.author} You don't have permission to do that!`);
        return;
    }

    try {
        msg.content = content;
        (cmdFn)(msg, cmdKey, args.slice(1));
        return;
    } catch (error) {
        let output = `${msg.author} Error: ${error.message}.`;
        const helpOutput = errorHelp(cmdKey);
        if (helpOutput) output += `\n${helpOutput}`;
        msg.channel.send(output);
        console.error(`Error encountered while handling '${msg.content}':`, error);
    }
}

const helpAlias = Object.entries(cmdJson.cmdJumps)
    .find(kvp => kvp[1] === helpMessage)[0];

function errorHelp(cmdKey, args) {
    if (!helpAlias) return null;
    if (args && args.length > 0) args = ` ${args.join(' ')}`;
    else args = '';
    return `Type \`${prefixes[0]}${helpAlias} ${cmdKey}${args}\` for help.`;
}

function is_askTheOracle(msg, cmdKey, args) {
    const chan = msg.channel;
    const data = cmdJson.cmdData[is_askTheOracle.name];
    const argJumps = data.argJumps;
    const argLabels = data.argLabels;

    let invalidArgsMsg =
        msg.author +
        ' A likelihood is required. Please use a whole number between ' +
        '0-100 or one of the following:\n' +
        Object.keys(argJumps).map(s => '`' + s + '`').join(', ');
    const helpOutput = errorHelp(cmdKey);
    if (helpOutput) invalidArgsMsg += `\n${helpOutput}`;

    if (args.length < 1) {
        chan.send(invalidArgsMsg);
        return;
    }
    if (matchArg(is_askTheOracle, args[0], is_oracleLookupTable)) {
        is_oracleLookupTable(msg, cmdKey, args.slice(1), args[0]);
        return;
    }

    let likelihood = args[0].toLowerCase();
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
    let output = `${likelihood} **${result}**…\n`;

    const comment = args.length > 1 ? args.slice(1).join(' ') : null;
    if (comment) output += `"${comment}"\n`;

    output += msg.author + ' ' +
        (result <= odds ? '**Yes**.' : '**No**.');
    chan.send(output);
}

function is_oracleLookupTable(msg, cmdKey, args, tableAlias) {
    const oracleNotFoundMsg =
        'Please specify an Oracle from the list:\n' +
        Object.keys(oracles.map).map(s => '`' + s + '`').join(', ');

    const helpOutput = errorHelp(cmdKey, [tableAlias]);

    if (args.length < 1) {
        let output = `${msg.author} ${oracleNotFoundMsg}`;
        if (helpOutput) output += `\n${helpOutput}`;
        msg.channel.send(output);
        return;
    }
    const oracleName = args[0].toLowerCase();
    const oracle = oracles.map[oracleName];
    if (!oracle) {
        let output = `${msg.author} Oracle \`${oracleName}\` not found.` +
            `${oracleNotFoundMsg}`;
        if (helpOutput) output += `\n${helpOutput}`;
        msg.channel.send(output);
        return;
    }
    //TODO: Check for oracle.results
    let roll = d(oracle.d ? oracle.d : 100);
    let output = `Consulting the Oracle of **${oracle.title}** vs. **${roll}**…\n`;

    const comment = args.length > 1 ? args.slice(1).join(' ') : null;
    if (comment) output += `"${comment}"\n`;

    const lookup = (results, roll) => Object.keys(results).find(k => k >= roll);
    let key = lookup(oracle.results, roll);
    const value = oracle.results[key];
    const list = [];
    switch (oracle.type) {
    case null:
        output += `${msg.author} **${value}**.`;
        break;
    case 'multipleColumns':
        output += `${msg.author} `;
        for (let i = 0; i < oracle.results[key].length; i++) {
            let s = '';
            if (oracle.headers && i < oracle.headers.length) {
                s += `${oracle.headers[i]}: `;
            }
            s += `**${value[i]}**.`;
            list.push(s);
        }
        output += list.join(' ');
        break;
    case 'nested':
        roll = d(value.d ? value.d : 100); //TODO: Accept nested "d"
        output += `    **${value.title}** vs. **${roll}**…\n`;
        key = lookup(value.results, roll);
        output += `    _${value.prompt}_\n` +
            `${msg.author} **${value.results[key]}**.`;
        break;
    default:
        console.error(`Oracle '${oracle.title}' has unsupported type '${oracle.type}'.`);
    }
    msg.channel.send(output);
}

function resolveArg(cmdFn, argAlias) {
    return cmdJson.cmdData[cmdFn.name].argJumps[argAlias.toLowerCase()];
}

function matchArg(cmdFn, argAlias, argFn) {
    return resolveArg(cmdFn, argAlias) == argFn.name;
}

function rollDice(msg, _cmdKey, args) {
    const expression = args.join('');
    const r = new Dice().execute(expression);
    msg.channel.send(r.text);
}

function d(sides, count = 1) {
    return rInt(1, sides, count);
}

function rInt(min, max, count = 1) {
    if (count == 1) return Math.floor(Math.random() * (max - min + 1)) + min;
    return Array.apply(null, Array(count)).map(() => rInt(min, max));
}

function is_rollActionDice(msg, cmdKey, args) {
    const chan = msg.channel;
    const mods = args.reduce((m, s) => {
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
        if (action + mods > challenge[i]) {
            success++;
        }
    }

    const successStr = ['Miss...', 'Weak hit!', '_Strong hit!_'][success];
    result += `\n${msg.author} ${successStr}`;

    if (challenge[0] == challenge[1]) result += ' _MATCH!_';
    chan.send(result);
}

function aw_rollMoveDice(msg, cmdKey, args) {
    const chan = msg.channel;
    const mods = args.reduce((m, s) => {
        const i = parseInt(s);
        return m + (i ? i : 0);
    }, 0);
    const action = d(6, 2);
    const total = action[0] + action[1] + mods;
    const modStr = args.reduce((s, n) => {
        const i = parseInt(n);
        if (!i && i !== 0) return s;
        return s + ' ' + (i < 0 ? '-' : '+') + ' ' + Math.abs(i);
    }, '');
    let result = '' +
        `**${total}** (**${action[0]}** & **${action[1]}**${modStr})`;

    let success;
    if (total <= 6) success = 0;
    else if (total <= 9) success = 1;
    else success = 2;
    const successStr = ['Miss...', 'Mixed success!', '_Success!_'][success];
    result += `\n${msg.author} ${successStr}`;

    chan.send(result);
}

function login() {
    return client.login(tokens.discord.botAccount);
}

function reconnectDiscordClient(msg, _cmdKey, _args) {
    const a = msg.author;

    console.info(`Reset request received from ${a.id} (${a.username}#${a.discriminator}).`);
    console.log('Resetting.');

    msg.channel.send(`Resetting at the request of ${a}.`)
        .then(() => client.destroy())
        .then(() => login());
}

function exitProcess(msg, _cmdKey, _args) {
    const a = msg.author;

    console.info(`Shutdown request received from ${a.id} (${a.username}#${a.discriminator}).`);
    console.log('Shutting down.');

    msg.channel.send(`Shutting down at the request of ${a}.`)
        .then(() => client.destroy())
        .then(() => process.exit(0));
}


const helpSymbols = (() => {
    const symbols = {
        helpList: (msg) => {
            return Object.keys(cmdJson.cmdData).reduce((s, cmdKey) => {
                // if (cmdKey === helpMessage.name) return s;

                const cmd = cmdJson.cmdData[cmdKey];

                let marker = '';
                if (cmd.requiresOwner) {
                    if (!isOwner(msg.author)) return s;

                    marker = '&';
                }
                const aliases = cmd.aliases.map(alias => '`' + alias + '`').join(', ');
                if (s) s += '\n\n';
                return s + `${aliases}\n${marker}**${cmd.title}**\n    ${cmd.description}`;
            }, '');
        },
        selfPing: (_msg) => client.user.toString()

    };

    return Object.keys(symbols).reduce((result, key) => {
        const regexp = new RegExp('\\${' + key + '}', 'gm');
        result.push({
            regexp: regexp,
            function: symbols[key]
        });
        return result;
    }, []);
})();

function helpMessage(msg, _cmdKey, args) {
    let helpFn = args && args.length > 0 ?
        cmdJson.cmdJumps[args[0]] : helpMessage;

    let output = `${msg.author}`;

    if (!helpFn) {
        output += ` Command \`${args[0]}\` not recognized.`;
        helpFn = helpMessage;
    }

    let helpText = cmdJson.cmdData[helpFn.name].helpText;
    if (!helpText) helpText = '_(No documentation)_';


    helpSymbols.forEach(symbol => {
        if (!symbol.regexp.test(helpText)) return;
        const result = symbol['function'](msg);
        helpText = helpText.replace(symbol.regexp, result);
    });

    output += '\n' + helpText;

    msg.channel.send(output);
}

function isOwner(user) {
    return user.id === tokens.discord.ownerId;
}