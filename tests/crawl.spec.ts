import {ElementHandle, test} from '@playwright/test';
import * as fs from "fs";


test.use({
    ignoreHTTPSErrors: true,
});

const downloads_dir = process.cwd() + '/downloads';

// Create a function `readme_md` that takes the ElementHandle of an HTML table and write its content to a markdown file
async function readme_md(table: ElementHandle, apartExplications: ElementHandle, dir: string) {
    async function table_to_array(table: ElementHandle) {
        const rows = await table.$$('tr');
        return await Promise.all(rows.map(async (row: any) => {
            const columns = await row.$$('td');
            return Promise.all(columns.map(async (column: any) => {
                return await column.innerText();
            }));
        }));
    }

    const {markdownTable} = await import('markdown-table');
    const data = await table_to_array(table);

    const plan = data[1][0];
    let markdown = `# План квартири ${plan}\n\n`;
    markdown += markdownTable(data) + "\n";
    markdown += "![" + plan + "](./render.jpg)\n\n";

    let explications = await table_to_array(apartExplications)
    explications.unshift(['Приміщення', 'Площа']);
    markdown += markdownTable(explications);
    markdown += "\n\n## 📁[План приміщення](plan.pdf)"
    markdown += "\n\n## 📁[План поверху](floor.pdf)"

    const filename = 'README.md';
    const output_dir = dir + '/' + plan;

    fs.mkdirSync(output_dir, {recursive: true});
    fs.writeFileSync(output_dir + '/' + filename, markdown);

    const size = data[1][1];

    return {plan, size, output_dir};
}

const buildings = {
    '16Г': '136,139',
    '16Д': '728,729',
    '18Б': '1977,1978',
    '18А': '2912,2913',
    '20А': '3658,3659',
    '20Б': '4740,4741',
};
const generator = function* (): Generator<{ building: string, url: string }> {
    for (const [building, sections] of Object.entries(buildings)) {
        const urls = [
            `https://sg-7.com/ua/plansfilter/planlist/?count_rooms_from=1&count_rooms_to=6&general_space_from=35&general_space_to=177&etazh_from=1&etazh_to=25&sections=${sections}&two_levels=false`,
            `https://sg-7.com/ua/plansfilter/planlist/?count_rooms_from=1&count_rooms_to=6&general_space_from=35&general_space_to=177&etazh_from=1&etazh_to=25&sections=${sections}&two_levels=true`
        ];

        for (const url of urls) {
            yield {building, url};
        }
    }
}

test('Has pages', async ({page, context}) => {
    test.setTimeout(0);

    const newTab = await context.newPage();
    const list = new Array<{ plan: string, size: string, building: string }>();
    const fails = new Array<{ url: string, error: any }>();

    for await (const {building, url} of generator()) {
        const planDir = downloads_dir + '/' + building;
        await page.goto(url);
        await page.isVisible('text=загальна');

        fs.mkdirSync(downloads_dir, {recursive: true});

        const elements = await page.$$('a.preview_room');

        for (const element of elements) {
            const url = 'https://sg-7.com' + await element.getAttribute('href')!;
            try {
                await newTab.goto(url, {timeout: 0});

                const generalInfoTable = await newTab.$('.apart_general_info');
                const apartExplications = await newTab.$('.apart_explications');
                const image = await newTab.$('.apart_img img');
                const {plan, size, output_dir} = await readme_md(generalInfoTable, apartExplications, planDir);

                const downloadPromise = newTab.waitForEvent('download');
                const planLink = await newTab.getByRole('link', {name: 'План квартири'});
                // Modify link to force "save as" insead of preview
                await newTab.evaluate((link) => link.setAttribute('download', 'plan.pdf'), await planLink.elementHandle());
                await planLink.click();
                const planDownload = await downloadPromise;
                await planDownload.saveAs(output_dir + '/plan.pdf');


                const floorLink = await newTab.getByRole('link', {name: 'План поверху'});
                const floorDownloadPromise = newTab.waitForEvent('download');
                await newTab.evaluate((link) => link.setAttribute('download', 'floor.pdf'), await floorLink.elementHandle());
                await floorLink.click();
                const floorDownload = await floorDownloadPromise;
                await floorDownload.saveAs(output_dir + '/floor.pdf');

                const imageSrc = await image.getAttribute('src');
                const imageResponse = await newTab.goto('https://sg-7.com' + imageSrc);
                const buffer = await imageResponse.body()
                fs.writeFileSync(output_dir + '/render.jpg', buffer);

                list.push({plan, size, building});
            } catch (e) {
                fails.push({url, error: e.message});
            }
        }
    }

    let glossary = '# Плани квартир\n\n';
    const orderedArray = list.sort((a, b) => a.plan.localeCompare(b.plan));

    // Create a markdown file with the list of plans, grouped by building and ordered by plan
    for (const building of Object.keys(buildings)) {
        const buildingPlans = orderedArray.filter((plan) => building === plan.building);
        glossary += `## ${building}\n\n`;
        glossary += buildingPlans.map(({plan, size}) => `* [${plan}](./${plan}/README.md) - ${size} м²`).join('\n');
    }

    glossary += '\n\n## Fails\n\n';
    glossary += fails.map(({url, error}) => `* [${url}](${url}) - ${error}`).join('\n');

    fs.writeFileSync(downloads_dir + '/README.md', glossary);
})
