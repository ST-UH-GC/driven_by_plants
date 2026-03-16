<?php
/**
 * Plugin Name: Driven by Plants
 * Plugin URI:  https://kurkista.fi
 * Description: Interaktiivinen ravinto-opas – hae ruoka-aineita, analysoi aterioita ja tarkista ravintoaineiden saanti tieteelliseen tietoon perustuen.
 * Version:     0.1.0
 * Author:      Kurkista.fi
 * License:     GPL v2 or later
 * Text Domain: driven-by-plants
 */

if ( ! defined( 'ABSPATH' ) ) exit;

define( 'DBP_VERSION',    '0.1.0' );
define( 'DBP_PLUGIN_URL', plugin_dir_url( __FILE__ ) );

// USDA key stays server-side — never sent to the browser.
// Define DBP_USDA_KEY in wp-config.php to override, e.g.:
//   define( 'DBP_USDA_KEY', 'your-key-here' );
if ( ! defined( 'DBP_USDA_KEY' ) ) {
    define( 'DBP_USDA_KEY', 'Zf5cxCvUWHjXDHuggtvVms2GbBcv08Ln5yx4zrAS' );
}

// REST proxies — all external API calls go server-side so no keys or
// CORS issues ever reach the browser.
add_action( 'rest_api_init', function () {

    // Fineli: food search
    register_rest_route( 'dbp/v1', '/fineli/search', [
        'methods'             => 'GET',
        'callback'            => 'dbp_fineli_search_proxy',
        'permission_callback' => '__return_true',
        'args'                => [
            'q' => [ 'required' => true, 'sanitize_callback' => 'sanitize_text_field' ],
        ],
    ] );

    // Fineli: single food detail
    register_rest_route( 'dbp/v1', '/fineli/food/(?P<id>\d+)', [
        'methods'             => 'GET',
        'callback'            => 'dbp_fineli_food_proxy',
        'permission_callback' => '__return_true',
    ] );

    // USDA: food search (key stays server-side)
    register_rest_route( 'dbp/v1', '/usda', [
        'methods'             => 'GET',
        'callback'            => 'dbp_usda_proxy',
        'permission_callback' => '__return_true',
        'args'                => [
            'query' => [ 'required' => true, 'sanitize_callback' => 'sanitize_text_field' ],
        ],
    ] );

    // USDA: single food detail — returns full nutrient profile including amino acids
    register_rest_route( 'dbp/v1', '/usda/food/(?P<fdcId>\d+)', [
        'methods'             => 'GET',
        'callback'            => 'dbp_usda_food_proxy',
        'permission_callback' => '__return_true',
    ] );

} );

function dbp_fineli_search_proxy( WP_REST_Request $request ) {
    $url = add_query_arg( [
        'q'    => $request->get_param( 'q' ),
        'lang' => 'fi',
        'size' => 15,
    ], 'https://fineli.fi/fineli/api/v1/foods' );

    $response = wp_remote_get( $url, [ 'timeout' => 10 ] );
    if ( is_wp_error( $response ) ) {
        return new WP_Error( 'fineli_error', 'Fineli request failed', [ 'status' => 502 ] );
    }
    return rest_ensure_response( json_decode( wp_remote_retrieve_body( $response ) ) );
}

function dbp_fineli_food_proxy( WP_REST_Request $request ) {
    $id  = absint( $request->get_param( 'id' ) );
    $url = "https://fineli.fi/fineli/api/v1/foods/{$id}?lang=fi";

    $response = wp_remote_get( $url, [ 'timeout' => 10 ] );
    if ( is_wp_error( $response ) ) {
        return new WP_Error( 'fineli_error', 'Fineli request failed', [ 'status' => 502 ] );
    }
    return rest_ensure_response( json_decode( wp_remote_retrieve_body( $response ) ) );
}

function dbp_usda_food_proxy( WP_REST_Request $request ) {
    $fdc_id = absint( $request->get_param( 'fdcId' ) );
    $url    = add_query_arg(
        [ 'api_key' => DBP_USDA_KEY ],
        "https://api.nal.usda.gov/fdc/v1/food/{$fdc_id}"
    );

    $response = wp_remote_get( $url, [ 'timeout' => 10 ] );
    if ( is_wp_error( $response ) ) {
        return new WP_Error( 'usda_error', 'USDA request failed', [ 'status' => 502 ] );
    }
    return rest_ensure_response( json_decode( wp_remote_retrieve_body( $response ) ) );
}

function dbp_usda_proxy( WP_REST_Request $request ) {
    $url = add_query_arg( [
        'query'    => $request->get_param( 'query' ),
        'pageSize' => 12,
        // Restrict to comprehensive databases that include amino acid data.
        // SR Legacy and Foundation foods have full nutrient profiles.
        // Branded foods are excluded — they rarely have amino acid data and
        // show duplicate names (e.g. 12 entries all called "TOFU").
        'dataType' => 'SR Legacy,Foundation,Survey (FNDDS)',
        'api_key'  => DBP_USDA_KEY,
    ], 'https://api.nal.usda.gov/fdc/v1/foods/search' );

    $response = wp_remote_get( $url, [ 'timeout' => 10 ] );
    if ( is_wp_error( $response ) ) {
        return new WP_Error( 'usda_error', 'USDA request failed', [ 'status' => 502 ] );
    }
    return rest_ensure_response( json_decode( wp_remote_retrieve_body( $response ) ) );
}

function dbp_shortcode() {
    wp_enqueue_style(
        'dbp-style',
        DBP_PLUGIN_URL . 'assets/css/app.css',
        [],
        DBP_VERSION
    );
    wp_enqueue_script(
        'dbp-app',
        DBP_PLUGIN_URL . 'assets/js/app.js',
        [],
        DBP_VERSION,
        true
    );
    // Only proxy URLs are passed to the browser — no credentials.
    wp_localize_script( 'dbp-app', 'DBP_CONFIG', [
        'fineliSearch' => rest_url( 'dbp/v1/fineli/search' ),
        'fineliFood'   => rest_url( 'dbp/v1/fineli/food' ),
        'usdaProxy'    => rest_url( 'dbp/v1/usda' ),
        'usdaDetail'   => rest_url( 'dbp/v1/usda/food' ),
    ] );

    ob_start();
    ?>
    <div id="dbp-app" class="dbp-app">

      <!-- HEADER -->
      <div class="dbp-header">
        <h2 class="dbp-title">Driven by Plants</h2>
        <p class="dbp-subtitle">Ravinto-opas – tutki ruoka-aineiden ravintoarvoja ja analysoi aterioitasi</p>
      </div>

      <!-- SEARCH -->
      <div class="dbp-search-section">
        <div class="dbp-search-wrap">
          <div class="dbp-search-box">
            <span class="dbp-search-icon">&#128269;</span>
            <input
              type="text"
              id="dbp-search-input"
              class="dbp-search-input"
              placeholder="Hae ruoka-ainetta, esim. linssit, tofu, pinaatti, kaura..."
              autocomplete="off"
              spellcheck="false"
            >
            <button id="dbp-search-clear" class="dbp-search-clear" style="display:none" aria-label="Tyhjennä haku">&#10005;</button>
          </div>
          <div id="dbp-search-results" class="dbp-search-results" role="listbox" style="display:none"></div>
        </div>
      </div>

      <!-- MAIN LAYOUT -->
      <div class="dbp-main">

        <!-- LEFT: MEAL BUILDER -->
        <div class="dbp-panel dbp-panel--meal">
          <div class="dbp-panel__header">
            <h3>Ateria</h3>
            <button id="dbp-clear-meal" class="dbp-btn dbp-btn--ghost" style="display:none">Tyhjennä</button>
          </div>
          <div id="dbp-meal-list" class="dbp-meal-list">
            <div class="dbp-meal-empty">
              <span class="dbp-meal-empty__icon">&#127821;</span>
              <p>Hae ja lisää ruoka-aineita<br>ationalle yllä olevalla haulla</p>
            </div>
          </div>
        </div>

        <!-- RIGHT: ANALYSIS -->
        <div class="dbp-panel dbp-panel--analysis">
          <div id="dbp-analysis-empty" class="dbp-analysis-empty">
            <span class="dbp-analysis-empty__icon">&#128202;</span>
            <p>Lisää ruoka-aineita aterialle<br>nähdäksesi ravintoaineanalyysin</p>
          </div>
          <div id="dbp-analysis-content" class="dbp-analysis-content" style="display:none">

            <div class="dbp-section">
              <h4 class="dbp-section__title">Makroravintoaineet</h4>
              <div id="dbp-macros" class="dbp-macros-grid"></div>
            </div>

            <div class="dbp-section">
              <h4 class="dbp-section__title">Tärkeimmät ravintoaineet</h4>
              <p class="dbp-section__note">Osuus päivittäisestä viitearvosta (EFSA AI, aikuinen)</p>
              <div id="dbp-key-nutrients" class="dbp-nutrient-list"></div>
            </div>

            <div class="dbp-section">
              <h4 class="dbp-section__title">Välttämättömät aminohapot</h4>
              <p class="dbp-section__note">Osuus WHO:n viitearvosta per proteiinigramma</p>
              <div id="dbp-amino-acids" class="dbp-amino-grid"></div>
            </div>

            <div id="dbp-recommendations" class="dbp-section dbp-recommendations" style="display:none">
              <h4 class="dbp-section__title">&#128161; Suositukset</h4>
              <div id="dbp-recommendations-content"></div>
            </div>

          </div>
        </div>

      </div>

      <!-- FOOTER -->
      <div class="dbp-footer-note">
        <p>
          Tiedot: <a href="https://fineli.fi" target="_blank" rel="noopener">Fineli – Kansallinen elintarvikekoostumus&shy;tietokanta</a> (Ruokavirasto) &amp;
          <a href="https://fdc.nal.usda.gov" target="_blank" rel="noopener">USDA FoodData Central</a>.
          Arvot per 100&nbsp;g tai aterian mukaan skaalattuina.
          Ei korvaa ravitsemusterapeutin neuvoja.
        </p>
      </div>

    </div>
    <?php
    return ob_get_clean();
}

add_shortcode( 'vegan_guide', 'dbp_shortcode' );
