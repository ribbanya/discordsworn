declare module 'node-dice-js' {
    interface Options {
        command: string;
        throttles: {
            timer: number,
            repeat: number,
            faces: number,
            multiplier: number,
            modifier: number
        };
    }

    class Dice {
        constructor(options: Options);
    }
}