/**
 * @file Servidor backend para la aplicación de Búsqueda Federada.
 * Este servidor expone un endpoint `/search` que:
 * 1. Recibe una consulta del usuario.
 * 2. Expande la consulta usando la API de DataMuse.
 * 3. Realiza búsquedas en paralelo en las APIs de Europeana y PLOS.
 * 4. Combina, normaliza y ordena los resultados.
 * 5. Devuelve una lista unificada de resultados al frontend.
 */

require('dotenv').config(); // Carga las variables de entorno desde .env
const express = require('express');
const axios = require('axios');
const cors = require('cors'); // Para permitir peticiones desde el frontend

const app = express();
const PORT = process.env.PORT || 3000; // Puerto en el que correrá el servidor

// Middleware
app.use(cors()); // Habilita CORS para que el frontend pueda comunicarse
app.use(express.json()); // Para parsear cuerpos de petición JSON (no estrictamente necesario para GET, pero buena práctica)

// --- Configuración de APIs ---
const EUROPEANA_API_KEY = process.env.EUROPEANA_API_KEY;
if (!EUROPEANA_API_KEY) {
    console.error("ERROR: La variable de entorno EUROPEANA_API_KEY no está configurada en el archivo .env.");
    console.error("Por favor, obtén una clave API de Europeana en https://pro.europeana.eu/page/get-an-api-key y configúrala.");
    process.exit(1); // Sale de la aplicación si no hay clave API
}

const DATAMUSE_API_URL = 'https://api.datamuse.com/words';
const EUROPEANA_API_URL = 'https://api.europeana.eu/record/v2/search.json';
const PLOS_API_URL = 'https://api.plos.org/search';

/**
 * Realiza la expansión de un término de búsqueda utilizando la API de DataMuse.
 * @param {string} term - El término a expandir.
 * @returns {Promise<string[]>} - Un array de palabras relacionadas.
 */
async function expandQuery(term) {
    try {
        // 'ml' busca palabras que significan lo mismo que el término
        // 'max=5' limita el número de palabras relacionadas para no sobrecargar la consulta
        const response = await axios.get(`${DATAMUSE_API_URL}?ml=${encodeURIComponent(term)}&max=5`);
        return response.data.map(word => word.word);
    } catch (error) {
        console.error(`Error al expandir el término "${term}" con DataMuse:`, error.message);
        return []; // Retorna un array vacío en caso de error
    }
}

/**
 * @route GET /search
 * @description Endpoint principal de búsqueda.
 * @param {string} req.query.q - La consulta de búsqueda introducida por el usuario.
 * @returns {JSON} - Un array de objetos de resultado, combinados y ordenados por relevancia.
 */
app.get('/search', async (req, res) => {
    const userQuery = req.query.q; // Obtiene la consulta del usuario del parámetro 'q'

    if (!userQuery) {
        return res.status(400).json({ error: 'El parámetro de consulta "q" es requerido.' });
    }

    // --- 1. Procesamiento y Expansión de la Consulta ---
    const originalTerms = userQuery.split(' ').filter(term => term.trim() !== '');
    
    // 1.1. Expansión de la consulta con la lógica (Término1 OR SinónimoA) AND (Término2 OR SinónimoB)
    // 2. Reactivamos la expansión de consulta con la nueva lógica (OR para sinónimos, AND para términos)

    // Ejecutamos la expansión de todos los términos en paralelo para mayor eficiencia
    const expansionPromises = originalTerms.map(term => expandQuery(term));
    const allSynonyms = await Promise.all(expansionPromises);

    // Creamos los grupos de consulta (término OR sinónimo1 OR sinónimo2)
    const queryGroups = originalTerms.map((term, index) => { // 1.2. Construcción de grupos de consulta
        const synonyms = allSynonyms[index];
        // Usamos un Set para asegurar que no haya duplicados en el grupo (ej. si DataMuse devuelve el término original)
        const groupTerms = [...new Set([term, ...synonyms])];
        // Si solo hay un término en el grupo, no necesitamos paréntesis ni OR
        return groupTerms.length > 1 ? `(${groupTerms.join(' OR ')})` : term;
    });

    // Unimos los grupos con AND
    const queryString = queryGroups.join(' AND '); // 1.3. Creación de la cadena de consulta final

    if (!queryString) {
        console.log("La cadena de búsqueda final está vacía. No se realizarán peticiones a las APIs.");
        return res.json([]);
    }

    console.log(`Consulta Original: "${userQuery}"`);
    console.log(`Cadena de Consulta Final para APIs (con lógica OR/AND): "${queryString}"`); // Log para depuración

    // --- 2. Búsqueda Federada en Paralelo ---
    const searchPromises = [
        // Promesa para buscar en Europeana
        axios.get(EUROPEANA_API_URL, {
            params: { query: queryString, wskey: EUROPEANA_API_KEY, rows: 20 }
        }),
        // Promesa para buscar en PLOS
        axios.get(PLOS_API_URL, {
            params: { q: queryString, wt: 'json', fl: 'title_display,score,id', rows: 20 }
        })
    ];

    // --- 3. Procesamiento y Combinación de Resultados ---
    // Promise.allSettled espera a que todas las promesas terminen, incluso si algunas fallan.
    const results = await Promise.allSettled(searchPromises);
    let allResults = [];

    const [europeanaResult, plosResult] = results;

    // 3.1. Procesar resultados de Europeana
    if (europeanaResult.status === 'fulfilled' && europeanaResult.value.data && europeanaResult.value.data.items) {
        // Log para ver si se encontraron items
        console.log(`Europeana encontró ${europeanaResult.value.data.items.length} items.`);

        const europeanaItems = europeanaResult.value.data.items.map(item => {
            const title = item.title && item.title.length > 0 ? item.title[0] : 'Sin Título';
            const link = item.edmIsShownBy || item.edmIsShownAt || '#';
            const score = item.score || 0;
            return {
                title: title,
                source: 'Europeana',
                original_relevance_score: score,
                link: link,
                normalized_score: 0
            };
        });
        allResults = allResults.concat(europeanaItems);
    } else if (europeanaResult.status === 'fulfilled') {
        // Log para inspeccionar la respuesta exitosa pero inesperada de Europeana
        console.log('--- RESPUESTA EXITOSA DE EUROPEANA (INESPERADA) ---');
        console.log(JSON.stringify(europeanaResult.value.data, null, 2));
        console.log('-------------------------------------------------');
    } else if (europeanaResult.status === 'rejected') {
        // Si la API de Europeana falla, lo registramos en la consola del servidor.
        // Imprimimos el error completo para obtener más detalles (ej. código de estado 401, 403).
        console.error('--- ERROR DETALLADO DE EUROPEANA ---');
        if (europeanaResult.reason.response) {
            console.error('Status:', europeanaResult.reason.response.status);
            console.error('Data:', europeanaResult.reason.response.data);
        } else {
            console.error('Mensaje:', europeanaResult.reason.message);
        }
        console.error('------------------------------------');
    }

    // 3.2. Procesar resultados de PLOS
    if (plosResult.status === 'fulfilled' && plosResult.value.data && plosResult.value.data.response && plosResult.value.data.response.docs) {
        // Log para ver si se encontraron items
        console.log(`PLOS encontró ${plosResult.value.data.response.docs.length} documentos.`);

        const plosItems = plosResult.value.data.response.docs.map(doc => {
            const title = doc.title_display || 'Sin Título';
            const score = doc.score || 0;
            const link = doc.id ? `https://journals.plos.org/plosone/article?id=${doc.id}` : '#';
            return {
                title: title,
                source: 'PLOS',
                original_relevance_score: score,
                link: link,
                normalized_score: 0
            };
        });
        allResults = allResults.concat(plosItems);
    } else if (plosResult.status === 'fulfilled') {
        // Log para inspeccionar la respuesta exitosa pero inesperada de PLOS
        console.log('--- RESPUESTA EXITOSA DE PLOS (INESPERADA) ---');
        console.log(JSON.stringify(plosResult.value.data, null, 2));
        console.log('---------------------------------------------');
    } else if (plosResult.status === 'rejected') {
        console.error('--- ERROR DETALLADO DE PLOS ---');
        if (plosResult.reason.response) {
            console.error('Status:', plosResult.reason.response.status);
            console.error('Data:', plosResult.reason.response.data);
        } else {
            console.error('Mensaje:', plosResult.reason.message);
        }
        console.error('-------------------------------');
    }


    // --- 4. Normalización y Ranking de Resultados ---
    if (allResults.length > 0) {
        // Encontrar la puntuación máxima de todos los resultados obtenidos
        const maxScore = Math.max(...allResults.map(r => r.original_relevance_score), 0);

        // Si maxScore es 0 (ej. todas las puntuaciones originales eran 0), asignamos 1 para evitar división por cero
        // y que todos los resultados tengan una relevancia normalizada de 1.
        const divisor = maxScore > 0 ? maxScore : 1;
        allResults.forEach(result => {
            // Normalización min-max, asumiendo que la puntuación mínima es 0
            result.normalized_score = result.original_relevance_score / divisor;
        });
    }

    // 4.1. Ordena los resultados finales por 'normalized_score' de mayor a menor
    allResults.sort((a, b) => b.normalized_score - a.normalized_score);

    res.json(allResults); // Envía los resultados al frontend
});

// Sirve los archivos estáticos del frontend desde la carpeta 'public'
app.use(express.static('public'));

// Inicia el servidor
app.listen(PORT, () => {
    console.log(`Servidor backend corriendo en http://localhost:${PORT}`);
    console.log(`Frontend accesible en http://localhost:${PORT}/index.html`);
});
