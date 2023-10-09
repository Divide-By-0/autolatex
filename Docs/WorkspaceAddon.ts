function onWorkspaceAddonHomepageOpen() {
  return generateWorkspaceHomepage("Idle");
}

function generateWorkspaceHomepage(status: string, error: string | null = null) {
  const homeCard = CardService.newCardBuilder().setName("home");
  const instructionsSection = CardService.newCardSection()
    .addWidget(CardService.newTextParagraph().setText("Replace all valid mathematical equations with high-quality LaTeX rendered images.<br>Remember to wrap all latex in $$ ... $$."))
    .addWidget(CardService.newTextParagraph().setText("For example, $$3^{4^5} + \\frac{1}{2}$$ would be a valid equation. Try using this sample to render your first equation!"));

  const prefs = getPrefs();

  const sizes = [
    ["Automatic", "smart"],
    ["Inline", "inline"],
    ["Font Size 24", "med"],
    ["Font Size 12", "low"]
  ];

  const delims = [
    ["$$ ... $$", "$$"],
    ["\\[ ... \\]", "\["]
  ];

  const sizeSelect = CardService.newSelectionInput()
    .setType(CardService.SelectionInputType.DROPDOWN)
    .setTitle("Select Size:")
    .setFieldName("size");

  const delimSelect = CardService.newSelectionInput()
    .setType(CardService.SelectionInputType.DROPDOWN)
    .setTitle("Select Delimiter Style:")
    .setFieldName("delimit")

  for (const size of sizes) sizeSelect.addItem(size[0], size[1], size[1] === (prefs.size || "smart"));
  for (const delim of delims) delimSelect.addItem(delim[0], delim[1], delim[1] === (prefs.delim || "$$"));

  const settingsSection = CardService.newCardSection()
    .setHeader("Settings")
    .setCollapsible(true)
    .setNumUncollapsibleWidgets(1)
    .addWidget(sizeSelect)
    .addWidget(delimSelect);

  const renderButton = CardService.newTextButton()
    .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
    .setText("Render Equations")
    .setOnClickAction(CardService.newAction().setFunctionName("onWorkspaceAddonClick").setParameters({ action: "render" }));

  const derenderButton = CardService.newTextButton()
    .setTextButtonStyle(CardService.TextButtonStyle.TEXT)
    .setText("Derender Eq. ")
    .setOnClickAction(CardService.newAction().setFunctionName("onWorkspaceAddonClick").setParameters({ action: "derender" }));

  const derenderAllButton = CardService.newTextButton()
    .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
    .setText("⠀⠀DE-RENDER ALL EQUATIONS⠀⠀")
    .setBackgroundColor("#cd3d2d")
    .setOnClickAction(CardService.newAction().setFunctionName("onWorkspaceAddonClick").setParameters({ action: "derenderAll" }));

  const statusText = `<b>Status: ${status}</b>`;

  const actionsSection = CardService.newCardSection()
    .addWidget(CardService.newButtonSet()
      .addButton(renderButton)
      .addButton(derenderButton)
      .addButton(derenderAllButton)
    )
    .addWidget(CardService.newTextParagraph().setText(error ? `${statusText}<br><font color="#dd4b39">${error}</font>` : statusText));

  const infoSection = CardService.newCardSection()
    .addWidget(CardService.newDecoratedText()
      .setTopLabel("Tips:")
      .setWrapText(true)
      .setText(`• Place your cursor right before the equation and click "De-render Equation" to convert back to code.
• Use shift+enter instead of enter for newlines in multi-line equations. Shift+enter auto-converts to \\\\.
• 'Automatic' size matches the typed font size.
• 'Inline' size compresses your equation height.`)
    )
    .addWidget(CardService.newImage()
      .setImageUrl("https://i.ibb.co/41B2V1C/unnamed.png")
      .setOpenLink(CardService.newOpenLink().setUrl("https://www.patreon.com/autolatex?source=docs"))
    )
    .addWidget(CardService.newDecoratedText()
      .setTopLabel("More:")
      .setWrapText(true)
      .setText(`• <b>We have <a href="https://www.redbubble.com/shop/ap/140480196">merch now</a>! Buy shirts, pillows, mugs, and more for your math-loving friends and students.</b>
• Check out Auto-LaTeX in your Slides presentations!
• Check out the latest <a href="https://sites.google.com/site/autolatexequations/">2022 Update Notes</a>.
• Find a full list of commands at <a href="https://www.codecogs.com/eqnedit.php">CodeCogs</a>.
• Problems? Check the <a href="https://www.autolatex.com/faq">FAQ</a>, <a href="mailto:autolatex@gmail.com">autolatex@gmail.com</a>, or check updates on <a href="https://www.facebook.com/autolatex/">facebook</a>.
• I'd love a <a href="https://workspace.google.com/marketplace/app/autolatex_equations/850293439076?hl=en&pann=docs_addon_widget&ref=sidebar_review">5 star review here</a>!
• Please <a href="https://www.patreon.com/autolatex?source=docs">donate</a> on Patreon to help keep this updated!
• I recently built <a href="https://lipoker.io/?ref=ale">lipoker.io</a>, the first free videochat poker site for friends, without signups or downloads. Think of it as the Auto-LaTeX of poker -- no scams, and beautifully functional. Try it for your next social or game night!`)
    )

  homeCard.addSection(instructionsSection);
  homeCard.addSection(settingsSection);
  homeCard.addSection(actionsSection);
  homeCard.addSection(infoSection);
  return homeCard.build();
}

function onWorkspaceAddonClick(e: GoogleAppsScript.Addons.EventObject) {
  const selectedSize = e.commonEventObject.formInputs.size.stringInputs.value[0];
  const selectedDelimit = e.commonEventObject.formInputs.delimit.stringInputs.value[0];
  let statusText: string;
  let error: string | null = null;
  switch(e.commonEventObject.parameters.action) {
    case "render": {
      const result = e.docs ? replaceEquations(selectedSize, selectedDelimit) : replaceEquationsSheets(selectedSize, selectedDelimit);
      let errorType = 0;
      let renderCount = result;
      if (result < -1) {
        errorType = -2;
        renderCount = -2 - result;
      } else if (result == -1) {
        errorType = -1;
        renderCount = 0;
      }
      statusText = renderCount === 0 ? "No equations rendered" : renderCount === 1 ? "1 equation rendered" : `${renderCount} equations rendered`;
      if (errorType === -1)
        error = "Sorry, the script has conflicting authorizations. Try signing out of other active Gsuite accounts.";
      else if (errorType === -2 && renderCount > 0)
        error = "Sorry, an equation is incorrect, or (temporarily) unavailable commands (i.e. align, &) were used.";
      else if (errorType === -2 && renderCount == 0)
        error = "Sorry, likely (temporarily) unavailable commands (i.e. align, &) were used or the equation was too long.";
      
      break; 
    } case "derender": {
      // TODO: Different messages for sheets
      const result = e.docs ? editEquations(selectedSize, selectedDelimit) : derenderEquationSheets(selectedSize, selectedDelimit);
      switch (result) {
        case Common.DerenderResult.InvalidUrl:
          statusText = "Error, please ensure link is still on equation.";
          error = "Cannot retrieve equation. The equation may not have been rendered by Auto-LaTeX.";
          break;
        case Common.DerenderResult.NullUrl:
          statusText = "Error, please ensure link is still on equation.";
          error = "Cannot retrieve equation. Is your cursor before an Auto-LaTeX rendered equation?";
          break;
        case Common.DerenderResult.EmptyEquation:
          statusText = "Error, please move cursor before inline equation.";
          error = "Cannot retrieve equation. Is your cursor before an Auto-LaTeX rendered equation?";
          break;
        case Common.DerenderResult.NonExistentElement:
          statusText = "Error, please move cursor before equation.";
          error = "Cannot insert text here. Is your cursor before an equation?";
          break;
        case Common.DerenderResult.CursorNotFound:
          statusText = "Error, please move cursor before equation.";
          error = "Cannot find a cursor/equation. Please click before an equation."
          break;
        case Common.DerenderResult.Success:
        default:
          statusText = "1 equation de-rendered.";
          break;
      }
      break;
    } case "derenderAll": {
      const derenderCount = e.docs ? removeAll(selectedDelimit) : derenderAllSheets(selectedDelimit);
      statusText = derenderCount === 0 ? "No equations found to de-render" : derenderCount === 1 ? "1 equation de-rendered" : `${derenderCount} equations de-rendered`;
      break;
    }
  }
  
  return CardService.newActionResponseBuilder().setNavigation(CardService.newNavigation().updateCard(generateWorkspaceHomepage(statusText, error))).build();
}