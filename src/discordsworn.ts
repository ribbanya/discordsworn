﻿import { User, Client, DMChannel, Message } from 'discord.js';
import * as fs from 'fs';
import * as ws from 'ws';
import * as dateFormat from 'dateformat';
import * as Dice from 'node-dice-js';
import * as assert from 'assert';

const client = new Client(); {
    client.on('ready', function onReady() { console.log('Ready.'); });
    client.on('message', onMsg);
    client.on('error', function onError(error: Error | ErrorEvent) {
        console.error(error);
        const webSocketClosed =
            error instanceof ErrorEvent
            && error.target instanceof ws
            && error.target.readyState === ws.CLOSED;
        if (!webSocketClosed) return;
        console.info('WebSocket closed unexpectedly. Reestablishing connection...');
        client.destroy().then(() => login());
    });
    client.on('messageUpdate', onMsgUpdate);
}

interface Map<T> {
    [key: string]: T
}

type CommandFunction = (msg: Message, parsedMsg: ParsedMessage) => void;
type CommandJumpTable = Map<CommandFunction>;

const supportedCommands = [
    is_askTheOracle, is_rollActionDice,
    aw_rollMoveDice,
    rollDice,
    helpMessage,
    reconnectDiscordClient, exitProcess, embedTest
].reduce((sc: CommandJumpTable, fn: CommandFunction): CommandJumpTable => {
    sc[fn.name as string] = fn;
    return sc;
}, {} as CommandJumpTable); //TODO separate module

const supportedArgs = { //TODO: supportedCommands[cmdKey].supportedArgs
    [is_askTheOracle.name]: [
        is_oracleLookupTable.name,
        '0', '10', '25', '50', '75', '90', '100'
    ]
};

const supportedOracles = [null, 'multipleColumns', 'nested'];

const prefixes = ['.']; //TODO user settings

function syncParseJson(filename: string) {
    return JSON.parse(fs.readFileSync(filename, 'utf8'));
}

const tokens = syncParseJson('tokens.json');
const oracles = parseOraclesJson(syncParseJson('oracles.json'));

const cmdJson = parseCmdJson(syncParseJson('commands.json'));

login();

function formatArg(arg: string) {
    return arg.toLowerCase().replace(/\s+/g, '-');
}

interface CommandJson {
    cmdData: Map<any>, //TODO
    cmdJumps: CommandJumpTable
}
function parseCmdJson(json: any /* TODO */): CommandJson {
    const cmdData: Map<any> = {};
    const cmdJumps: CommandJumpTable = {};

    const isMissing = (array: any[]) => !array || array.length < 1;
    const keysIncludes = (object: object, key: string) => Object.keys(object).includes(key);

    const parseJumps = (cmdKey: string) => {

        const aliases = json[cmdKey].aliases;
        const listener = supportedCommands[cmdKey];

        if (isMissing(aliases)) {
            console.warn(
                `Command '${cmdKey}' does not have any aliases. ` +
                `Using '${cmdKey}' instead.`
            );
            cmdJumps[cmdKey] = listener;
        } else {
            aliases.forEach((alias: string) => {
                if (cmdJumps.hasOwnProperty(alias)) {
                    console.warn(`'${cmdKey}' is attempting to assign duplicate alias '${alias}'. Skipping.`);
                    return;
                }
                alias = formatArg(alias);
                cmdJumps[alias] = listener;
            });
        }
    };

    const parseArgLabels = (cmdKey: string) => json[cmdKey].argLabels || null;


    const parseArgJumps = (cmdKey: string): Map<string> | null => {
        const group = json[cmdKey].argAliases;

        if (isMissing(group)) return null;

        const argJumps: Map<string> = {};

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
            list.forEach((alias: string) => {
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
    Object.keys(json).forEach((cmdKey: string) => {
        const cmd = json[cmdKey];
        if (!keysIncludes(supportedCommands, cmdKey)) {
            console.warn(
                `Command ${cmdKey} is not supported. Skipping command.`
            );
            return;
        }
        parseJumps(cmdKey);
        cmdData[cmdKey] = {};
        const data = cmdData[cmdKey];
        data.argJumps = parseArgJumps(cmdKey);
        data.argLabels = parseArgLabels(cmdKey);
        Object.assign(data, cmd);
    });

    return {
        cmdData: cmdData,
        cmdJumps: cmdJumps
    };
}
interface AnyJson { //TODO
    [key: string]: any
}
function parseOraclesJson(json: AnyJson) {
    json.map = {};
    root: for (let i = 0; i < json.length; i++) {
        const oracle = json[i];
        oracle.type = oracle.type || null;
        let identifier = `Oracle at index ${i}`;
        const warn = (s: string) => console.warn(`${identifier}` + s + ' Skipping.');
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
                        warn(`${key} is not an integer`);
                        continue root;
                    }

                    if (key < 1) {
                        warn(`${keyId} is below the minimum value (1).`);
                        continue root;
                    }
                    if (key > d) {
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
        const mapOracle = (s: string) => {
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
            oracle.aliases.forEach((e: string) => mapOracle(e));
        }
    }
    return json;
}
interface ParsedMessage {
    args: string[],
    cmdKey: string,
    content: string
}
function parseMsg(msg: Message): ParsedMessage | null {
    if (msg.author.id === client.user.id) return null;

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
            msg.channel instanceof DMChannel;

        if (!relevant) return null;
    }

    let args = content.split(' ');
    const cmdKey = args[0].toLowerCase();
    args = args.slice(1);
    content = args.join(' ');

    return {
        args: args,
        cmdKey: cmdKey,
        content: content
    };
}

function onMsg(msg: Message) {
    const parsedMsg = parseMsg(msg);
    if (!parsedMsg) return;

    const cmdFn = cmdJson.cmdJumps[parsedMsg.cmdKey];

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
        (cmdFn)(msg, parsedMsg);
        return;
    } catch (error) {
        let output = `${msg.author} Error: ${error.message}.`;
        const helpOutput = errorHelp(parsedMsg.cmdKey, undefined);
        if (helpOutput) output += `\n${helpOutput}`;
        msg.channel.send(output);
        console.error(`Error encountered while handling '${msg.content}':`, error);
    }
}


const helpAlias = (() => {
    const result = Object.entries(cmdJson.cmdJumps)
        .find(kvp => kvp[1] === helpMessage);
    if (!result) throw 'Help command not found.';
    return result;
})()[0];

function errorHelp(cmdKey: string, args?: string[]) {
    if (!helpAlias) return null;
    const argStr: string = args && args.length > 0 ?
        ` ${args.join(' ')}` : '';
    return `Type \`${prefixes[0]}${helpAlias} ${cmdKey}${argStr}\` for help.`;
}

function is_askTheOracle(msg: Message, parsedMsg: ParsedMessage) {
    const chan = msg.channel;
    const data = cmdJson.cmdData[is_askTheOracle.name];
    const { args, cmdKey } = parsedMsg;
    const { argJumps, argLabels } = data;

    let invalidArgsMsg =
        msg.author +
        ' A likelihood is required. Please use a whole number between ' +
        '0-100 or one of the following:\n' +
        Object.keys(argJumps).map(s => '`' + s + '`').join(', ');
    const helpOutput = errorHelp(cmdKey, undefined);
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

function is_oracleLookupTable(msg: Message, cmdKey: string, args: string[], tableAlias: string) {
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

    const lookup = (results: object /* TODO */, roll: string): string | undefined =>
        Object.keys(results).find((k: string) => k >= roll);
    let key = lookup(oracle.results, roll);

    const keyNotFoundMsg = (roll: string) => `${roll} was not found among ${oracle.title}'s keys.`;

    if (!key) throw keyNotFoundMsg(roll);
    const value = oracle.results[key];
    const list: string[] = [];
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
            if (!key) throw keyNotFoundMsg(roll);
            output += `    _${value.prompt}_\n` +
                `${msg.author} **${value.results[key]}**.`;
            break;
        default:
            console.error(`Oracle '${oracle.title}' has unsupported type '${oracle.type}'.`);
    }
    msg.channel.send(output);
}

function resolveArg(cmdFn: CommandFunction, argAlias: string) {
    return cmdJson.cmdData[cmdFn.name].argJumps[argAlias.toLowerCase()];
}

function matchArg(cmdFn: CommandFunction, argAlias: string, argFn: Function /* TODO */) {
    return resolveArg(cmdFn, argAlias) == argFn.name;
}

function rollDice(msg: Message, parsedMsg: ParsedMessage) {
    const { args } = parsedMsg;
    const expression = args.join('');
    const r = new Dice().execute(expression);

    msg.channel.send(r.outcomes[0].rolls.toString());
}

function d(sides: number, count: number = 1) {
    return rInt(1, sides, count);
}

function rInt(min: number, max: number, count: number = 1) {
    if (count == 1) return Math.floor(Math.random() * (max - min + 1)) + min;
    return Array.apply(null, Array(count)).map(() => rInt(min, max));
}

function is_rollActionDice(msg: Message, parsedMsg: ParsedMessage) {
    const { args } = parsedMsg;
    const chan = msg.channel;
    const mods = args.reduce((m, s) => {
        const i = parseInt(s);
        return m + (i ? i : 0);
    }, 0);
    const challenge = d(10, 2);
    const action = d(6);
    const challengeStr = challenge.map((n: number) => (action + mods) > n ? `__${n}__` : n);
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

function aw_rollMoveDice(msg: Message, parsedMsg: ParsedMessage) {
    const { args } = parsedMsg;
    const chan = msg.channel;
    const mods = args.reduce((m: number, s: string) => {
        const i = parseInt(s);
        return m + (i ? i : 0);
    }, 0);
    const action = d(6, 2);
    const total = action[0] + action[1] + mods;
    const modStr = args.reduce((s: string, n: string) => {
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

function reconnectDiscordClient(msg: Message, _parsedMsg: ParsedMessage) {
    const a = msg.author;

    console.info(`Reset request received from ${a.id} (${a.username}#${a.discriminator}).`);
    console.log('Resetting.');

    msg.channel.send(`Resetting at the request of ${a}.`)
        .then(() => client.destroy())
        .then(() => login());
}

function exitProcess(msg: Message, _parsedMsg: ParsedMessage) {
    const a = msg.author;

    console.info(`Shutdown request received from ${a.id} (${a.username}#${a.discriminator}).`);
    console.log('Shutting down.');

    msg.channel.send(`Shutting down at the request of ${a}.`)
        .then(() => client.destroy())
        .then(() => process.exit(0));
}

interface HelpSymbol {
    regexp: RegExp,
    function: (msg: Message) => string
}
const helpSymbols = (() => {
    const symbols: { [key: string]: Function } = {
        helpList: (msg: Message) => {
            return Object.keys(cmdJson.cmdData).reduce((s, cmdKey) => {
                // if (cmdKey === helpMessage.name) return s;

                const cmd = cmdJson.cmdData[cmdKey];

                let marker = '';
                if (cmd.requiresOwner) {
                    if (!isOwner(msg.author)) return s;

                    marker = '&';
                }
                const aliases = cmd.aliases.map((alias: string) => '`' + alias + '`').join(', ');
                if (s) s += '\n\n';
                return s + `${aliases}\n${marker}**${cmd.title}**\n    ${cmd.description}`;
            }, '');
        },
        selfPing: (_msg: Message) => client.user.toString()

    };

    return Object.keys(symbols).reduce((result: HelpSymbol[], key: string) => {
        const regexp: RegExp = new RegExp('\\${' + key + '}', 'gm');
        result.push({
            regexp: regexp,
            function: symbols[key]
        } as HelpSymbol);
        return result;
    }, []);
})();

function helpMessage(msg: Message, parsedMsg: ParsedMessage) {
    const { args } = parsedMsg;
    let helpFn = args && args.length > 0 ?
        cmdJson.cmdJumps[args[0]] : helpMessage;

    let output = `${msg.author}`;

    if (!helpFn) {
        output += ` Command \`${args[0]}\` not recognized.`;
        helpFn = helpMessage;
    }

    let helpText = cmdJson.cmdData[helpFn.name].helpText;
    if (!helpText) helpText = '_(No documentation)_';


    helpSymbols.forEach((symbol: HelpSymbol) => {
        if (!symbol.regexp.test(helpText)) return;
        const result = symbol['function'](msg);
        helpText = helpText.replace(symbol.regexp, result);
    });

    output += '\n' + helpText;

    msg.channel.send(output);
}

function isOwner(user: User) {
    return user.id === tokens.discord.ownerId;
}

const recentEmbeds: { [key: string]: Message } = {};

function embedError(error: Error) {
    return {
        title: 'Error',
        description: '```\n' + error.message + '\n```'
    };
}

function parseOptionsJson(json: string) {
    try {
        return JSON.parse(json);
    } catch (error) {
        return { embed: embedError(error) };
    }
}

function embedTest(msg: Message, parsedMsg: ParsedMessage) {
    const options = parseOptionsJson(parsedMsg.content);
    msg.channel.send(options.content || msg.author.toString(), options)
        .then((v) => {
            if (!(v instanceof Message)) {
                throw v;
            }
            recentEmbeds[msg.id] = v;
        });
}

function onMsgUpdate(oldMsg: Message, newMsg: Message) {
    assert(oldMsg.id === newMsg.id);
    const target = recentEmbeds[oldMsg.id];
    if (!target) return;
    const targetEmbed = target.embeds.find(e => e.type === 'rich');
    if (!targetEmbed) return;

    const pm = parseMsg(newMsg);
    if (!pm) return;

    const { cmdKey } = pm;
    let { content } = pm;

    if (cmdJson.cmdJumps[cmdKey] !== embedTest) {
        content = newMsg.content;
    }

    const embedError = (error: Error) => ({
        title: 'Error',
        description: '```\n' + error.message + '\n```'
    });

    const options = parseOptionsJson(content);
    target.edit(options.content || target.content, options)
        .catch(error =>
            target.channel.send(target.author.toString(), {
                embed: embedError(error)
            }));
}