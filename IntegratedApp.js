IntegratedApp = {
  getUi: function(type){
    if(type == "Slides"){
      return SlidesApp.getUi();
    } else if (type == "Docs"){
      return DocumentApp.getUi();
    }
  },
  getBody: function(){
    if(type == "Slides"){    
      return SlidesApp.getActivePresentation().getSlides();
    } else if (type == "Docs"){
      return DocumentApp.getActiveDocument().getBody();
    } else if (type == "Sheets"){
      return SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
    }
  },
  getActive: function(){
    if(type == "Slides"){    
      return SlidesApp.getActivePresentation();
    } else if (type == "Docs"){
      return DocumentApp.getActiveDocument();
    } else if (type == "Sheets"){
      return SpreadsheetApp.getActiveSpreadsheet();
    }
  },
  getPageWidth: function() {
    if(type == "Slides"){
      return IntegratedApp.getActive().getPageWidth();
    } else if (type == "Docs"){
      return DocumentApp.getActiveDocument().getPageWidth();
    }
  }
};