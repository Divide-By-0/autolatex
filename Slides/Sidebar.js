/// <reference path="../types/slides-types/index.d.ts" />
/// <reference types="jquery" />

/* global google, $ */

// @ts-check

/**
 * On document load, assign click handlers to each button. Added document.ready.
 */

$('document').ready(function(){
  $(function() {
      google.script.run.withSuccessHandler(loadPreferences)
          .withFailureHandler(showError).getPrefs();
      $('#insert-text').click(insertText);
      $('#edit-text').click(editText);
      $('#undo-all').click(undoAll);
      $('#renderList').click(showRenderDropdown);
  });
});
function showRenderDropdown() {
  $('#renderList').toggleClass('show');
}

function runDotAnimation() {
  return setInterval(function() {
    if ($("#loading").html().length >= 18) 
      $("#loading").html("Status: Loading");
    else
      $("#loading").html($("#loading").text()+'.');
  }, 300);
}

function getCurrentSettings() {
  const sizeRaw = (/** @type {string} */ ($('#size :selected').val()));
  const delimiter = (/** @type {string} */ ($('#delimit :selected').val()));
  return {sizeRaw, delimiter};
}

//$('donate_button').on("click",function(e){e.preventDefault;}); // for paypal to disable sidebar disappearing

// Close the dropdown menu if the user clicks outside of it
/**
 * @param {MouseEvent} event
 */
window.onclick = function(event) {
  if (!(/** @type {HTMLElement?} */ (event.target))?.matches('.dropbtn')) {

    var dropdowns = document.getElementsByClassName("dropdown-content");
    var i;
    for (i = 0; i < dropdowns.length; i++) {
      var openDropdown = dropdowns[i];
      if (openDropdown.classList.contains('show')) {
        openDropdown.classList.remove('show');
      }
    }
  }
}
$("#advanced").click(function(event){//.live({click:
  event.preventDefault();
  $("#divDelimiters").attr("style", function(i, origValue){
    if(origValue == "display: block;"){
      $("#advanced").text("Show Advanced Settings");
      return "display: none;";
    }
    else{
      $("#advanced").text("Hide Advanced Settings");
      return "display: block;";
    }
  });
});

function loadPreferences(choicePrefs) {
  $('#insert-text').prop("disabled", true);
  $('#edit-text').prop("disabled", true);
  $('#undo-all').prop("disabled", true);
  $('#size').val(choicePrefs.size);
  $('#delimit').val(choicePrefs.delim);
  $('#insert-text').prop("disabled", false);
  $('#edit-text').prop("disabled", false);
  $('#undo-all').prop("disabled", false);
}
  
function insertText(){ 
  // console.log("TEST insertText");
  this.disabled = true;
  $('#error').remove();
  $("#loading").html("Status: Loading");
  const runDots = runDotAnimation();
  const {sizeRaw, delimiter} = getCurrentSettings();

  google.script.run
    .withSuccessHandler(
      function(returnSuccess, element) {
        $("#loading").html('');
        clearInterval(runDots);
        element.disabled = false;
        console.log(returnSuccess);
        let flag = 0;
        let renderCount = 1;
        if(returnSuccess < -1){
          flag = -2;
          renderCount = -2 - returnSuccess;
        }
        else if(returnSuccess == -1){
          flag = -1;
          renderCount = 0;
        }
        else{
          flag = 0;
          renderCount = returnSuccess;
        }
        // var flag = returnSuccess.flag
        // var renderCount = returnSuccess.renderCount
        if(flag == -1)
          showError("Sorry, the script has conflicting authorizations. Try signing out of other active Gsuite accounts.", "Status: " + renderCount +  " equations replaced");
        else if(flag == -2 && renderCount > 0)
          showError("Sorry, the equation is too long or another problem occurred.", "Status: " + renderCount +  " equations replaced");
        else if(flag == -2 && renderCount == 0)
          showError("Sorry, the renderers are down, an equation is too long, or an equation is misformed.", "Status: " + renderCount +  " equations replaced");
        else if(flag == 0 && renderCount == 0)
          $("#loading").html("Status: " + "No"          + " equations rendered");
        else if(flag == 0 && renderCount == 1)
          $("#loading").html("Status: " + renderCount + " equation rendered" );
        else
          $("#loading").html("Status: " + renderCount + " equations rendered");
      })
    .withFailureHandler(
      function(msg, element) {
        $("#loading").html('');
        clearInterval(runDots);
        console.error("Error console errored!", msg, element)
        showError("Please ensure your equations are surrounded by $$ on both sides (or \\[ and an \\]), without any enters in between, or reload the page.", "Status: Error, please reload.");
        element.disabled = false;
      })
    .withUserObject(this)
    .replaceEquations(sizeRaw, delimiter);
}
    
    
function editText(){
  this.disabled = true;
  $('#error').remove();
  $("#loading").html("Status: Loading");
  
  const runDots = runDotAnimation();
  const {sizeRaw, delimiter} = getCurrentSettings();
  google.script.run
    .withSuccessHandler(
      function(returnSuccess, element) {
        $("#loading").html('');
        clearInterval(runDots);
        element.disabled = false;
        $("#loading").html("Status: " + "1"             + " equation replaced.");
        if(returnSuccess < 0)
          $("#loading").html("Status: " + "No"          + " equations replaced.");
          
        if(returnSuccess == -5)
          showError("Cannot retrieve equation. The equation may not have been rendered by Auto-LaTeX.", "Status: Error, please ensure link is still on equation.");
        else if(returnSuccess == -4)
          showError("Cannot retrieve equation. Is your equation selected?", "Status: Error, please ensure link is still on equation.");
        else if(returnSuccess == -3)
          showError("Cannot retrieve equation. Is your equation selected?", "Status: Error, please select image.");
        else if(returnSuccess == -2)
          showError("Cannot insert text here. Is your equation selected?", "Status: Error, please select equation.");
        else if(returnSuccess == -1)
          showError("Cannot find a equation. Please click on equation image.", "Status: Error, please select equation.");
        else if(returnSuccess == 0)
          $("#loading").html("Status: " + "Error: Please select equation image.");
        else if(returnSuccess == 1)
          $("#loading").html("Status: " + returnSuccess + " equation de-rendered.");
        else
          $("#loading").html("Status: " + 1             + " equation de-rendered.");
      })
    .withFailureHandler(
      function(msg, element) {
        $("#loading").html('');
        clearInterval(runDots);
        showError("Please select equation image to be derendered.", "Status: Error, please select equation to be derendered.");
        element.disabled = false;
      })
    .withUserObject(this)
    .editEquations(sizeRaw, delimiter);
}

    
function undoAll(){
  this.disabled = true;
  $('#error').remove();
  $("#loading").html("Status: Loading");
  //var div = $('<div id="clickmsg" class="text">' + 'Ctrl + q detected' + '</div>');
  //$('#button-bar').after(div);
  
  const runDots = runDotAnimation();
  const {delimiter} = getCurrentSettings();
  google.script.run
  .withSuccessHandler(
    function(returnSuccess, element) {
      $("#loading").html('');
      clearInterval(runDots);
      element.disabled = false;
      $("#loading").html("Status: " + 0 + " equations de-rendered.");
      if(returnSuccess < 0){
        $("#loading").html("Status: " + "No"          + " equations de-rendered.");
        showError("Cannot find any equations.", "Status: Error, please click equation image.");
      }
      else if(returnSuccess == 0)
        $("#loading").html("Status: " + "No"          + " equations found to de-render.");
      else if(returnSuccess == 1)
        $("#loading").html("Status: " + returnSuccess + " equation de-rendered.");
      else
        $("#loading").html("Status: " + returnSuccess + " equations de-rendered.");
    })
  .withFailureHandler(
    function(msg, element) {
      $("#loading").html('');
      clearInterval(runDots);
      showError("Please select image.", "Status: Error, please select image.");
      element.disabled = false;
    })
  .withUserObject(this)
  .removeAll(delimiter);
}

//ctrl+m to show developer key
$(document).keydown(function(e){ 
  if((e.ctrlKey && e.keyCode == 77)){
    $('#error').remove();
    
    google.script.run.withSuccessHandler(
      function(msg) {
        console.error('myFunction() yielded an error: ' + msg);
        $("#loading").html("Dev key for debugging: " + msg); //ADQsr0ZOimwdc5HmC+UsixLRc3UcLUweHoxoGd9uDOdSv9LgENOI11dsB9A0Jd2lNQI2PSrx3x0C

      })
    .withFailureHandler(
      function(msg) {
        $("#loading").html("Dev failed key for debugging: " + msg);
      })
    .withUserObject(this)
    .getKey();
  }
});

// Supposed to take keyboard shortcuts, but only local.
$(document).keydown(function(e){
  if((e.ctrlKey && e.keyCode == 81)){
    $('#error').remove();
    $("#loading").html("Status: Loading");
    //var div = $('<div id="clickmsg" class="text">' + 'Ctrl + q detected' + '</div>');
    //$('#button-bar').after(div);
    
    const runDots = runDotAnimation();
    const {delimiter} = getCurrentSettings();
    google.script.run
    .withSuccessHandler(
      function(returnSuccess) {
        $("#loading").html('');
        clearInterval(runDots);
        $("#loading").html("Status: " + 0 + " equations de-rendered.");
        if(returnSuccess < 0){
          $("#loading").html("Status: " + "No"          + " equations de-rendered.");
          showError("Cannot find any equations.", "Status: Error, please select image.");
        }
        else if(returnSuccess == 0)
          $("#loading").html("Status: " + "No"          + " equations found to de-render.");
        else if(returnSuccess == 1)
          $("#loading").html("Status: " + returnSuccess + " equation de-rendered.");
        else
          $("#loading").html("Status: " + returnSuccess + " equations de-rendered.");
      })
    .withFailureHandler(
      function() {
        $("#loading").html('');
        clearInterval(runDots);
        showError("Please select image.", "Status: Error, please select image.");
      })
    .removeAll(delimiter);
  }
});

/**
 * Inserts a div that contains an error message after a given element.
 *
 * @param msg1 The status to display.
 * @param msg2 The error message to display.
 */
function showError(msg1, msg2) {//CHANGE TO OTHER DIV WHEN PUBLISHING
  //var div = $('<div id="error" class="error">' + msg + '</div>');
  var div = $('<div id="error" class="error">' + msg1  + '</div>');
  $('#loading').after(div);
  $('#loading').html(msg2);
}
