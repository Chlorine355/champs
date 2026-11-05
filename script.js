// Данные о чемпионах вынесены в data.js (генерируется scripts/fetch-champions.mjs).
const DATA_SOURCE = './data.js';

const data = [];

const loadChampions = () => {
    if (Array.isArray(globalThis.CHAMPIONS) && globalThis.CHAMPIONS.length > 0) {
        data.push(...globalThis.CHAMPIONS);
        return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = DATA_SOURCE;
        script.onload = () => {
            if (!Array.isArray(globalThis.CHAMPIONS) || globalThis.CHAMPIONS.length === 0) {
                reject(new Error(`${DATA_SOURCE}: список чемпионов не найден`));
                return;
            }
            data.push(...globalThis.CHAMPIONS);
            resolve();
        };
        script.onerror = () => reject(new Error(`Не удалось загрузить ${DATA_SOURCE}`));
        document.head.appendChild(script);
    });
};

const getRandomcChampion = () =>
    data[Math.floor(Math.random() * data.length)];

const setChampion = (champion) => {
    imageElem.src = champion.src;
    nameElem.innerHTML = champion.name;
}

const imageElem = document.getElementById('image');
const nameElem = document.getElementById('name');
const button = document.getElementById('button');

loadChampions()
    .then(() => {
        setChampion(getRandomcChampion());

        button.addEventListener('click', () => { setChampion(getRandomcChampion()) });
    })
    .catch((error) => {
        nameElem.textContent = 'Не удалось загрузить чемпионов';
        console.error(error);
    });
