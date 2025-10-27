/**
 * @file Lógica del frontend para la aplicación de Búsqueda Federada.
 * Maneja la interacción del usuario, las llamadas al backend y la renderización de resultados.
 */

document.addEventListener('DOMContentLoaded', () => {
    // --- Selección de Elementos del DOM ---
    const searchInput = document.getElementById('searchInput');
    const searchButton = document.getElementById('searchButton');
    const loadingMessage = document.getElementById('loading');
    const errorMessage = document.getElementById('errorMessage');
    const resultsTable = document.getElementById('resultsTable');
    const resultsTableBody = resultsTable.querySelector('tbody');
    const noResultsMessage = document.getElementById('noResultsMessage');

    // --- Asignación de Eventos ---
    // Asigna el evento click al botón de búsqueda
    searchButton.addEventListener('click', performSearch);

    // Permite buscar presionando la tecla "Enter" en el campo de texto.
    searchInput.addEventListener('keypress', (event) => {
        if (event.key === 'Enter') {
            performSearch();
        }
    });

    /**
     * Función principal que se ejecuta al iniciar una búsqueda.
     * Recoge la consulta, llama al endpoint del backend y maneja la respuesta.
     */
    async function performSearch() {
        const query = searchInput.value.trim(); // Obtiene la consulta y elimina espacios extra
        if (!query) {
            displayError('Por favor, ingresa un término de búsqueda.');
            return;
        }

        // Prepara la interfaz para una nueva búsqueda (limpia resultados, muestra "cargando").
        resultsTableBody.innerHTML = '';
        resultsTable.classList.add('hidden');
        errorMessage.classList.add('hidden');
        noResultsMessage.classList.add('hidden');
        loadingMessage.classList.remove('hidden');

        try {
            // Realiza la petición GET al endpoint /search del backend.
            const response = await fetch(`http://localhost:3000/search?q=${encodeURIComponent(query)}`);

            if (!response.ok) {
                // Si la respuesta no es OK (ej. 400, 500), lanza un error
                const errorData = await response.json();
                throw new Error(errorData.error || `Error del servidor: ${response.status}`);
            }
            const data = await response.json(); // Parsea la respuesta JSON con los resultados.

            loadingMessage.classList.add('hidden'); // Oculta el mensaje de carga

            if (data.length === 0) {
                noResultsMessage.classList.remove('hidden'); // Muestra mensaje de "no resultados"
            } else {
                resultsTable.classList.remove('hidden'); // Muestra la tabla de resultados.
                data.forEach(result => {
                    // Por cada resultado, crea una nueva fila en la tabla.
                    const row = resultsTableBody.insertRow();
                    // 5. Interfaz de resultados: Título (como enlace), Fuente, Relevancia Original, Relevancia Normalizada
                    row.insertCell().innerHTML = `<a href="${result.link}" target="_blank" rel="noopener noreferrer">${result.title}</a>`;
                    row.insertCell().textContent = result.source;
                    row.insertCell().textContent = result.original_relevance_score.toFixed(4); // Formatea a 4 decimales
                    row.insertCell().textContent = result.normalized_score.toFixed(4); // Formatea a 4 decimales
                });
            }

        } catch (error) {
            // Si ocurre cualquier error durante el fetch, se muestra en la interfaz.
            console.error('Error en la búsqueda:', error);
            loadingMessage.classList.add('hidden');
            displayError(`Ocurrió un error al realizar la búsqueda: ${error.message}`);
        }
    }

    /**
     * Muestra un mensaje de error en el contenedor designado en la interfaz.
     * @param {string} message - El mensaje de error a mostrar.
     */
    function displayError(message) {
        errorMessage.textContent = message;
        errorMessage.classList.remove('hidden');
        resultsTable.classList.add('hidden');
        noResultsMessage.classList.add('hidden');
    }
});
