const discord = require("discord.js");
const fs = require('fs');
const client = new discord.Client();

//TODO: True RNG
const prefix = '.'

const tokens = JSON.parse(fs.readFileSync('tokens.json', 'utf8'))
login();

client.on("ready", () => {
    console.log("Ready.");
});

client.on("message", (msg) => {
    args = msg.content.split(' ');
    const chan = msg.channel;
    if (!args[0].startsWith(prefix))
        return;
    var cmd = args[0].substring(1).toLowerCase();
    args = args.slice(1);
    switch (cmd) {
        case 'act':
        case 'a':
            actionRoll(msg, args);
            break;
        case 'rngtest':
            var s = rInts(1, 9, 1000);
            s = s.join(' ');
            chan.send(s);
            break;
        case 'shutdown':
            shutdown(msg);
            break;
        case 'reset':
            reset(chan);
            break;
        case 'oracle':
        case 'o':
        case 'ask':
            askTheOracle(msg, args);
            break;
    }
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
        msg.author
        + ' A likelihood is required. Please use a whole number between '
        + '0-100 or one of the following:\n'
        + Object.keys(tierMap).map(s => '`' + s + '`').join(', ');
    if (args.length < 1) {
        chan.send(invalidArgsMsg)
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
    resultMsg += msg.author + ' '
        + (result <= odds ? '**Yes**.' : '**No**.');
    chan.send(resultMsg);
}

function d(sides, count = 1) {
    return rInt(1, sides, count);
}

function rInt(min, max, count = 1) {
    if (count == 1) return Math.floor(Math.random() * (max - min + 1)) + min;
    return Array.apply(null, Array(count)).map(n => rInt(min, max))
}

function actionRoll(msg, modifiers) {
    var chan = msg.channel;
    var mods = modifiers.reduce(function (m, s) {
        var i = parseInt(s);
        if (!i) return m;
        return m + i;
    }, 0);
    var challenge = d(10, 2);
    var action = d(6);
    var challengeStr = challenge.map(n => (action + mods) > n ? `__${n}__` : n);
    modStr = modifiers.length > 0 ? modifiers.reduce((m, s) => {
        if (parseInt(s))
            m.push(s);
        return m;
    }, []).join('+') : '0';
    var result = ''
        + `**${action + mods}** (**${action}**+${modStr})`
        + ` vs. **${challengeStr[0]}** & **${challengeStr[1]}**`;

    //var success = challenge.reduce(n => (action + mods) > n ? 1 : 0, 0);
    var success = 0;
    for (var i = 0; i < challenge.length; i++) {
        if (action + mods > challenge[i])
            success++;
    }

    var successStr = ["Miss...", "Weak hit!", "_Strong hit!_"][success];
    result += `\n${msg.author} ${successStr}`

    if (challenge[0] == challenge[1])
        result += ' _MATCH!_';
    chan.send(result)
}

function login() {
    client.login(tokens.discord.botAccount);
}

function reset(channel) {
    channel.send('Resetting...')
        .then(msg => client.destroy())
        .then(() => login());
}

function shutdown(msg) {
    const a = msg.author;
    console.info(`Shutdown request received from ${a.id} (${a.username}#${a.discriminator}.)`);
    if (a.id != tokens.discord.ownerId)
        return;

    console.log("Shutting down.");
    msg.channel.send(`Shutting down at the request of ${msg.author}.`)
        .then(() => client.destroy())
        .then(() => process.exit(0));
}