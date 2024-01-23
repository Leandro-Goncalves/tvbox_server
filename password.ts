import bcrypt from 'bcrypt';

const saltRounds = 10;

export const crypt = async (password: string) => {
    return new Promise<string>((res, rej) => {
        bcrypt.hash(password, saltRounds, function(err, hash) {
            if(err){
                rej(err)
                return;
            }

            res(hash)
        });
    })
}

export const compare = (text:string, hash: string) => {
    return new Promise<boolean>((res, rej) => {
        bcrypt.compare(text, hash, function(err, result) {
            if(err){
                rej(err)
                return;
            }

            res(result)
        });
    })
}